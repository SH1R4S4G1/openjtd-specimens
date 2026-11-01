import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyLink, checkSourceReferences, checkEvidence, EXPERIMENT_STORAGE_ROOTS } from '../src/evidence-references.mjs';
import { createRun, startSample, finalizeSample } from '../src/evidence.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));

async function scratch(t, prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `ichitaro-${prefix}-`));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function write(root, files) {
  for (const [name, contents] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
}

async function completedRun(storage, samples = ['baseline']) {
  const run = await createRun({ outputRoot: path.join(storage, 'runs'), experiment: { name: 'fixture', samples: samples.map(id => ({ id })) } });
  for (const id of samples.slice(0, 1)) {
    const sample = await startSample(run, { id, requested: {} });
    await fs.writeFile(sample.documentPath, 'opaque fixture bytes');
    await finalizeSample(sample);
  }
  return run;
}

// A source repository without any experiment storage next to it.
async function sourceTree(t, { docs, incompleteRuns = {} }) {
  const root = await scratch(t, 'source-tree');
  await write(root, {
    'README.md': '[guide](docs/guide.md)\n',
    'docs/guide.md': docs,
    'src/thing.mjs': '',
    '.gitignore': EXPERIMENT_STORAGE_ROOTS.map(name => `${name}/`).join('\n') + '\n',
    'evidence-expectations.json': { schemaVersion: 1, incompleteRuns },
  });
  return root;
}

test('links are classified at the repository / experiment storage boundary', () => {
  assert.deepEqual(classifyLink('docs/a.md', '../src/x.mjs#L2'), { kind: 'source', target: 'src/x.mjs' });
  assert.deepEqual(classifyLink('docs/a.md', '../runs/r/index.html'), { kind: 'evidence', target: 'runs/r/index.html' });
  assert.deepEqual(classifyLink('README.md', 'observations/o/a%20b.png'), { kind: 'evidence', target: 'observations/o/a b.png' });
  assert.deepEqual(classifyLink('docs/a.md', 'https://example.com/runs/x'), { kind: 'external' });
  assert.deepEqual(classifyLink('docs/a.md', '#section'), { kind: 'external' });
  assert.throws(() => classifyLink('docs/a.md', '../../outside.md'), /leaves the repository/);
});

test('the real source repository passes the portable gate without consulting experiment storage', async () => {
  const summary = await checkSourceReferences(repository);
  assert.ok(summary.sourceLinks > 0 && summary.evidenceLinks > 0 && summary.runs > 0);
});

test('portable gate passes without storage but still rejects broken source links and stale declarations', async t => {
  const id = '2026-10-12T01-42-17-981Z-023be8c2';
  const docs = `[code](../src/thing.mjs) [run](../runs/${id}/index.html) [note](../tmp/evidence.json) stopped run ${id}\n`;
  const root = await sourceTree(t, { docs, incompleteRuns: { [id]: 'stopped by design' } });
  assert.deepEqual(await checkSourceReferences(root), { sourceLinks: 2, evidenceLinks: 2, runs: 1 });

  await write(root, { 'docs/guide.md': docs + '[gone](../src/missing.mjs)\n' });
  await assert.rejects(checkSourceReferences(root), /missing source link \.\.\/src\/missing\.mjs/);

  await write(root, { 'docs/guide.md': '[code](../src/thing.mjs)\n' });
  await assert.rejects(checkSourceReferences(root), /is not referenced by README\/docs/);

  await write(root, { 'evidence-expectations.json': { schemaVersion: 1, incompleteRuns: {} }, '.gitignore': 'runs/\n' });
  await assert.rejects(checkSourceReferences(root), /must exclude experiment storage catalogs\//);
});

test('evidence gate fails loudly when experiment storage is absent instead of skipping', async t => {
  const root = await sourceTree(t, { docs: '[run](../runs/x/index.html)\n' });
  await fs.mkdir(path.join(root, 'tmp')); // stray scratch directory is not storage
  const result = await checkEvidence({ root });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /runs\/ not found/);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'STORAGE_NOT_FOUND');
});

test('evidence gate verifies documented links and run integrity in separate storage', async t => {
  const storage = await scratch(t, 'storage');
  const complete = await completedRun(storage);
  const stopped = await completedRun(storage, ['baseline', 'variant']);
  await write(storage, { 'catalogs/c/index.html': '' });
  const docs = `[ok](../runs/${complete.id}/index.html) [catalog](../catalogs/c/index.html) stopped ${stopped.id}\n`;
  const root = await sourceTree(t, { docs, incompleteRuns: { [stopped.id]: 'stopped after baseline' } });

  const axes = result => Object.fromEntries([...result.knownIncompleteRuns, ...result.rejectedRuns].map(({ run, integrity, completion, acceptance }) => [run, [integrity, completion, acceptance]]));

  let result = await checkEvidence({ root, storage });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.runs, { total: 2, integrityFailed: 0, incomplete: 1, accepted: 1, acceptedKnownIncomplete: 1, rejected: 0 });
  assert.deepEqual(result.knownIncompleteRuns, [{ run: `runs/${stopped.id}`, integrity: 'ok', completion: 'incomplete', acceptance: 'accepted-known-incomplete', declaredReason: 'stopped after baseline' }]);

  // Undeclared incomplete run: the observation stays a completion fact; rejection is the policy decision.
  await write(root, { 'evidence-expectations.json': { schemaVersion: 1, incompleteRuns: {} } });
  result = await checkEvidence({ root, storage });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map(error => [error.run, error.category, error.code]), [[`runs/${stopped.id}`, 'acceptance', 'UNDECLARED_INCOMPLETE_RUN']]);
  assert.ok(result.errors[0].observed.every(error => error.category === 'completion'));
  assert.deepEqual(axes(result), { [`runs/${stopped.id}`]: ['ok', 'incomplete', 'rejected'] });

  // Declaring a complete run as incomplete is stale.
  await write(root, { 'evidence-expectations.json': { schemaVersion: 1, incompleteRuns: { [stopped.id]: 'stopped', [complete.id]: 'wrong' } } });
  result = await checkEvidence({ root, storage });
  assert.deepEqual(result.errors.map(error => [error.category, error.code]), [['acceptance', 'STALE_INCOMPLETE_DECLARATION']]);
  assert.deepEqual(axes(result)[`runs/${complete.id}`], ['ok', 'complete', 'rejected']);

  // A declaration never excuses an integrity failure, and the run is not counted as accepted history.
  await write(root, { 'evidence-expectations.json': { schemaVersion: 1, incompleteRuns: { [stopped.id]: 'stopped' } } });
  await fs.writeFile(path.join(stopped.dir, 'samples', 'baseline', 'document.jtd'), 'tampered');
  await fs.rm(path.join(storage, 'catalogs', 'c', 'index.html'));
  result = await checkEvidence({ root, storage });
  assert.deepEqual(result.errors.map(error => error.code).sort(), ['ERROR', 'MISSING_EVIDENCE']);
  const integrityError = result.errors.find(error => error.code === 'ERROR');
  assert.equal(integrityError.category, 'integrity');
  assert.match(integrityError.message, /Hash\/size mismatch/);
  assert.deepEqual(result.runs, { total: 2, integrityFailed: 1, incomplete: 1, accepted: 1, acceptedKnownIncomplete: 0, rejected: 1 });
  assert.deepEqual(axes(result), { [`runs/${stopped.id}`]: ['failed', 'incomplete', 'rejected'] });
});

test('a linked execution-results.json brings every listed run under verification', async t => {
  const storage = await scratch(t, 'storage');
  const run = await completedRun(storage, ['baseline', 'variant']);
  await write(storage, { 'tmp/batch/execution-results.json': { results: [{ runDir: run.dir }] } });
  const root = await sourceTree(t, { docs: '[results](../tmp/batch/execution-results.json)\n' });
  const result = await checkEvidence({ root, storage });
  assert.equal(result.runs.total, 1);
  assert.deepEqual(result.errors.map(error => [error.run, error.code]), [[`runs/${run.id}`, 'UNDECLARED_INCOMPLETE_RUN']]);
  assert.deepEqual(result.errors[0].referencedBy, ['docs/guide.md -> tmp/batch/execution-results.json']);
});

test('additional storages hold runs the first storage lacks; a missing one fails loudly', async t => {
  const storage = await scratch(t, 'storage'), other = await scratch(t, 'other');
  const here = await completedRun(storage), there = await completedRun(other);
  await write(storage, { 'tmp/note.json': {} });
  const root = await sourceTree(t, { docs: `[run](../runs/${here.id}/index.html) [note](../tmp/note.json) earlier run ${there.id}\n` });
  // Alone, the first storage does not hold the other storage's run.
  let result = await checkEvidence({ root, storage });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.run === `runs/${there.id}`));
  result = await checkEvidence({ root, storage, additionalStorages: [other] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.runs.total, 2);
  assert.deepEqual(result.runsInAdditionalStorages, [{ run: `runs/${there.id}`, storage: other }]);
  result = await checkEvidence({ root, storage, additionalStorages: [path.join(other, 'absent')] });
  assert.deepEqual(result.errors.map(error => error.code), ['STORAGE_NOT_FOUND']);
});
