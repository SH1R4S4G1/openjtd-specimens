import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRun, startSample, appendEvent, saveEvidence, saveMacroEvidence, finalizeSample, failSample, verifyRun } from '../src/evidence.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB7sAAAAASUVORK5CYII=';
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]);
const JPEG = `data:image/jpeg;base64,${JPEG_BYTES.toString('base64')}`;

async function fixture(t, experiment = 'Test corpus') {
  const temporaryRoot = os.tmpdir();
  await fs.mkdir(temporaryRoot, { recursive: true });
  const outputRoot = await fs.mkdtemp(path.join(temporaryRoot, 'ichitaro-evidence-'));
  t.after(() => {
    assert.ok(path.resolve(outputRoot).startsWith(`${path.resolve(temporaryRoot)}${path.sep}ichitaro-evidence-`));
    return fs.rm(outputRoot, { recursive: true, force: true });
  });
  return createRun({ outputRoot, experiment, source: { kind: 'legitimate-application-ui' } });
}

// Deliberately non-JTD bytes stand in for an external producer; the evidence
// module must only preserve/hash bytes, never claim to validate JTD internals.
async function externalSave(sample) { await fs.writeFile(sample.documentPath, Buffer.from('opaque external application output')); }

const MACRO_SOURCE = 'DocumentStyleGet(1);\r\n';
const MACRO_RESULT = Buffer.from('\ufeff字数=40\r\n行数=30\r\n', 'utf16le');
const MACRO_PROOF = { passed: true, reopened: true, method: 'macro-getter' };
async function getterEvidence(sample, phase, verification = phase === 'reopened' ? MACRO_PROOF : { passed: false, reopened: false, method: 'macro-getter' }) {
  return saveMacroEvidence(sample, { phase, label: `<${phase}>`, macroSource: MACRO_SOURCE, resultBytes: MACRO_RESULT, observed: { settings: { chars: 40, lines: 30 }, units: 'macro' }, verification });
}

test('macro getter proof preserves and hashes ASCII source and raw UTF-16LE results without screenshots', async t => {
  const run = await fixture(t);
  const sample = await startSample(run, { id: 'macro', requested: { chars: 40, lines: 30 } });
  await externalSave(sample);
  const before = await getterEvidence(sample, 'before-save');
  await getterEvidence(sample, 'reopened');
  assert.deepEqual(before.files.map(file => [file.kind, file.encoding]), [['macro-source', 'ascii'], ['macro-result', 'utf-16le']]);
  for (const [artifact, bytes] of before.files.map((file, index) => [file, index === 0 ? Buffer.from(MACRO_SOURCE, 'ascii') : MACRO_RESULT])) {
    assert.deepEqual(await fs.readFile(path.join(sample.dir, artifact.path)), bytes);
    assert.equal(artifact.bytes, bytes.length);
    assert.equal(artifact.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  const manifest = await finalizeSample(sample);
  assert.equal(manifest.status, 'verified');
  assert.equal(manifest.verification.hasScreenshot, false);
  assert.equal(manifest.verification.hasMacroReadback, true);
  assert.equal(manifest.verification.method, 'macro-getter');
  assert.deepEqual(manifest.observed.settings, { chars: 40, lines: 30 });
  assert.equal((await verifyRun(run.dir)).ok, true);
  const html = await fs.readFile(path.join(run.dir, 'index.html'), 'utf8');
  assert.ok(html.includes(before.files[0].path));
  assert.ok(html.includes(before.files[1].path));
  assert.ok(html.includes('&lt;before-save&gt;'));
  await assert.rejects(getterEvidence(sample, 'reopened'), /already complete/);
});

test('body comparison policy and unmodified readback survive evidence, manifest and report',async t=>{
  const run=await fixture(t),sample=await startSample(run,{id:'wrapped',requested:{}});
  await externalSave(sample);await getterEvidence(sample,'before-save');
  const verification={...MACRO_PROOF,bodyMatches:true,bodyComparison:'single-paragraph-ignore-readback-line-breaks',bodyComparisonDetails:{ignoredReadbackLineBreaks:2,limitation:'Paragraph structure not verified.'}};
  await saveMacroEvidence(sample,{phase:'reopened',macroSource:MACRO_SOURCE,resultBytes:MACRO_RESULT,observed:{body:'甲\n乙\n丙'},verification});
  const manifest=await finalizeSample(sample);
  assert.equal(manifest.observed.body,'甲\n乙\n丙');
  assert.equal(manifest.verification.bodyComparison,verification.bodyComparison);
  assert.deepEqual(manifest.verification.bodyComparisonDetails,verification.bodyComparisonDetails);
  const stored=JSON.parse(await fs.readFile(path.join(sample.dir,'manifest.json'),'utf8'));
  assert.equal(stored.evidence.find(e=>e.phase==='reopened').observed.body,'甲\n乙\n丙');
  assert.match(await fs.readFile(path.join(run.dir,'index.html'),'utf8'),/single-paragraph-ignore-readback-line-breaks/);
  assert.equal((await verifyRun(run.dir)).ok,true);
});

test('macro evidence validates complete inputs before storing artifacts', async t => {
  const run = await fixture(t);
  const sample = await startSample(run, { id: 'invalid-macro', requested: {} });
  const input = { macroSource: MACRO_SOURCE, resultBytes: MACRO_RESULT };
  await assert.rejects(saveMacroEvidence(sample, { ...input, macroSource: '日本語' }), /ASCII/);
  await assert.rejects(saveMacroEvidence(sample, { ...input, macroSource: '' }), /ASCII/);
  for (const resultBytes of ['text', new Uint8Array(), new Uint8Array([1])]) await assert.rejects(saveMacroEvidence(sample, { ...input, resultBytes }), /UTF-16LE/);
  await assert.rejects(saveMacroEvidence(sample, { ...input, observed: [] }), /observed/);
  assert.deepEqual(await fs.readdir(path.join(sample.dir, 'evidence')), []);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(sample.dir, 'sample.json'), 'utf8')).evidence, []);
});

test('incomplete macro phases and arbitrary passed assertions cannot establish verified status', async t => {
  const run = await fixture(t);
  const cases = [
    ['before-only', ['before-save'], MACRO_PROOF],
    ['reopened-only', ['reopened'], MACRO_PROOF],
    ['wrong-order', ['reopened', 'before-save'], MACRO_PROOF],
    ['unpassed', ['before-save', 'reopened'], { ...MACRO_PROOF, passed: false }],
    ['not-reopened', ['before-save', 'reopened'], { ...MACRO_PROOF, reopened: false }],
    ['wrong-method', ['before-save', 'reopened'], { ...MACRO_PROOF, method: 'assertion' }],
  ];
  for (const [id, phases, proof] of cases) {
    const sample = await startSample(run, { id, requested: {} });
    await externalSave(sample);
    for (const phase of phases) await getterEvidence(sample, phase, phase === 'reopened' ? proof : undefined);
    const manifest = await finalizeSample(sample, { verification: MACRO_PROOF });
    assert.equal(manifest.status, 'saved', id);
    assert.equal(manifest.verification.hasMacroReadback, false, id);
  }
  const fake = await startSample(run, { id: 'metadata-only', requested: {} });
  await externalSave(fake);
  for (const phase of ['before-save', 'reopened']) await saveEvidence(fake, { phase, observed: { chars: 40 }, verification: MACRO_PROOF });
  assert.equal((await finalizeSample(fake, { verification: MACRO_PROOF })).status, 'saved');
  const screenshotOnly = await startSample(run, { id: 'screenshot-only-macro', requested: {} });
  await externalSave(screenshotOnly);
  await saveEvidence(screenshotOnly, { screenshots: [PNG], observed: { chars: 40 }, verification: MACRO_PROOF });
  assert.equal((await finalizeSample(screenshotOnly)).status, 'saved');
});

test('macro source and result tampering or disappearance prevents completion and integrity checks', async t => {
  const run = await fixture(t);
  for (const kind of ['macro-source', 'macro-result']) {
    const sample = await startSample(run, { id: kind, requested: {} });
    await externalSave(sample);
    const entry = await getterEvidence(sample, 'before-save');
    await getterEvidence(sample, 'reopened');
    const filename = path.join(sample.dir, entry.files.find(file => file.kind === kind).path);
    const original = await fs.readFile(filename);
    await fs.appendFile(filename, 'tamper');
    const manifest = await finalizeSample(sample);
    assert.equal(manifest.status, 'failed');
    assert.match(manifest.errors[0].message, /Evidence changed/);
    assert.equal((await verifyRun(run.dir)).ok, false);
    await fs.writeFile(filename, original);
    assert.equal((await verifyRun(run.dir)).ok, true);
    await fs.unlink(filename);
    assert.equal((await verifyRun(run.dir)).ok, false);
    await fs.writeFile(filename, original);
  }
  const missing = await startSample(run, { id: 'macro-missing-at-completion', requested: {} });
  await externalSave(missing);
  const entry = await getterEvidence(missing, 'before-save');
  await getterEvidence(missing, 'reopened');
  await fs.unlink(path.join(missing.dir, entry.files[1].path));
  const manifest = await finalizeSample(missing);
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.errors[0].code, 'ENOENT');
});

test('preserves raw evidence, separates requested from observed, and verifies the package', async t => {
  const run = await fixture(t);
  const sample = await startSample(run, { id: 'base', requested: { chars: 40, lines: 30, margins: { top: 20 } } });
  await externalSave(sample);
  await saveEvidence(sample, { label: 'settings', phase: 'after-change', accessibility: { text: '40 chars' }, screenshots: [{ data_url: PNG }], observed: { chars: 39, lines: 30, characterSpacing: '0', lineSpacing: '6', margins: { top: 20 } } });
  const manifest = await finalizeSample(sample, { expectedTitle: 'document.jtd', actualTitle: 'document.jtd', verification: { passed: true, method: 'explicit-ui-check' } });
  assert.equal(manifest.status, 'verified');
  assert.equal(manifest.requested.chars, 40);
  assert.equal(manifest.observed.chars, 39);
  assert.deepEqual(await fs.readFile(path.join(sample.dir, manifest.evidence[0].files[1].path)), Buffer.from(PNG.split(',')[1], 'base64'));
  assert.equal((await verifyRun(run.dir)).ok, true);
  await assert.rejects(saveEvidence(sample, { screenshots: [PNG] }), /already complete/);
  await assert.rejects(finalizeSample(sample), /already complete/);
});

test('preserves JPEG screenshots as JPEG bytes with a matching extension and media type', async t => {
  const run = await fixture(t);
  const sample = await startSample(run, { id: 'jpeg', requested: {} });
  await externalSave(sample);
  const entry = await saveEvidence(sample, { screenshots: [{ url: JPEG, mimeType: 'image/jpeg' }] });
  const artifact = entry.files[0];
  assert.equal(artifact.path, 'evidence/0001-screenshot-01.jpg');
  assert.equal(artifact.mediaType, 'image/jpeg');
  assert.deepEqual(await fs.readFile(path.join(sample.dir, artifact.path)), JPEG_BYTES);
  await finalizeSample(sample);
  assert.equal((await verifyRun(run.dir)).ok, true);
});

test('saved is distinct from verified, and mismatched titles prevent verified', async t => {
  const run = await fixture(t);
  const a = await startSample(run, { id: 'a', requested: {} });
  await externalSave(a);
  assert.equal((await finalizeSample(a, { verification: { passed: true } })).status, 'saved');
  const b = await startSample(run, { id: 'b', requested: { lines: 30 } });
  await externalSave(b);
  await saveEvidence(b, { screenshots: [PNG], observed: { lines: 30 } });
  const result = await finalizeSample(b, { expectedTitle: 'b.jtd', actualTitle: 'a.jtd', verification: { passed: true } });
  assert.equal(result.status, 'saved');
  assert.equal(result.verification.titleMatches, false);
});

test('missing save and explicit failures are recorded with completion timestamps', async t => {
  const run = await fixture(t);
  const missing = await startSample(run, { id: 'missing', requested: {} });
  const result = await finalizeSample(missing, { timeoutMs: 0 });
  assert.equal(result.status, 'failed');
  assert.equal(result.document, null);
  assert.ok(result.completedAt);
  assert.ok(result.errors.length);
  const failed = await startSample(run, { id: 'failed', requested: {} });
  assert.equal((await failSample(failed, new Error('Dialog not found'))).errors[0].message, 'Dialog not found');
  assert.equal((await verifyRun(run.dir)).ok, true); // Integrity, not experimental success.
});

test('rejects overwrites, path traversal, Windows reserved names, and remote screenshot URLs', async t => {
  const run = await fixture(t);
  for (const id of ['../escape', 'a/b', 'a\\b', 'CON', 'NUL.txt', 'trailing.', 'C:\\escape']) await assert.rejects(startSample(run, { id, requested: {} }));
  const sample = await startSample(run, { id: 'safe', requested: {} });
  await assert.rejects(startSample(run, { id: 'safe', requested: {} }), { code: 'EEXIST' });
  await assert.rejects(saveEvidence(sample, { screenshots: ['https://example.com/a.png'] }), /image\/png or image\/jpeg data URL/);
  await assert.rejects(saveEvidence(sample, { screenshots: [{ url: JPEG, mimeType: 'image/png' }] }), /MIME type mismatch/);
  await assert.rejects(saveEvidence(sample, { screenshots: ['data:image/webp;base64,AAAA'] }), /image\/png or image\/jpeg data URL/);
  assert.deepEqual(await fs.readdir(path.join(sample.dir, 'evidence')), []);
});

test('detects modified/missing JTD, modified screenshots, and manifest corruption', async t => {
  const run = await fixture(t);
  const sample = await startSample(run, { id: 'integrity', requested: {} });
  await externalSave(sample);
  await saveEvidence(sample, { screenshots: [PNG] });
  await finalizeSample(sample);
  const original = await fs.readFile(sample.documentPath);
  await fs.writeFile(sample.documentPath, 'tampered');
  assert.equal((await verifyRun(run.dir)).ok, false);
  await fs.unlink(sample.documentPath);
  assert.match(JSON.stringify((await verifyRun(run.dir)).errors), /ENOENT/);
  await fs.writeFile(sample.documentPath, original);
  await fs.appendFile(path.join(sample.dir, 'evidence/0001-screenshot-01.png'), 'tampered');
  assert.equal((await verifyRun(run.dir)).ok, false);
  await fs.writeFile(path.join(sample.dir, 'manifest.json'), '{ broken');
  assert.equal((await verifyRun(run.dir)).ok, false);
});

test('HTML escapes untrusted text and event writes serialize without losing entries', async t => {
  const run = await fixture(t, '<script>alert("experiment")</script>');
  const sample = await startSample(run, { id: 'escape', requested: { text: '<img src=x onerror=alert(1)>' } });
  await saveEvidence(sample, { screenshots: [PNG], label: '<script>unsafe</script>' });
  await failSample(sample, new Error('<script>failure</script>'));
  const html = await fs.readFile(path.join(run.dir, 'index.html'), 'utf8');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
  await Promise.all(Array.from({ length: 10 }, (_, i) => appendEvent(run, { type: 'test', i })));
  const events = JSON.parse(await fs.readFile(path.join(run.dir, 'events.json'), 'utf8'));
  assert.equal(events.filter(e => e.event.type === 'test').length, 10);
  assert.deepEqual(events.map(e => e.sequence), events.map((_, i) => i + 1));
});

test('pending and unindexed sample directories cannot silently pass integrity checks', async t => {
  const run = await fixture(t);
  await startSample(run, { id: 'pending', requested: {} });
  assert.equal((await verifyRun(run.dir)).ok, false);
  await fs.mkdir(path.join(run.dir, 'samples', 'unindexed'));
  assert.match(JSON.stringify((await verifyRun(run.dir)).errors), /UNINDEXED_SAMPLE/);
});

test('unstarted feature requests remain reviewable in the report', async t => {
  const features={font:{size:12}};
  const run=await fixture(t,{name:'extended',samples:[{id:'feature',settings:{},features,layoutPriority:'counts'}]});
  const index=JSON.parse(await fs.readFile(path.join(run.dir,'index.json'),'utf8'));
  assert.deepEqual(index.samples[0].requested,{features,layoutPriority:'counts'});
  assert.equal(index.samples[0].status,'not-started');
});

test('planned samples remain visible before starting and all must be indexed and completed', async t => {
  const run = await fixture(t, { name: 'planned', samples: [{ id: 'baseline', settings: { chars: 40 } }, { id: 'variant', settings: { chars: 39 } }] });
  const indexPath = path.join(run.dir, 'index.json');
  const initial = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  assert.deepEqual(initial.samples.map(sample => [sample.id, sample.status]), [['baseline', 'not-started'], ['variant', 'not-started']]);
  assert.deepEqual(initial.samples[1].requested, { chars: 39 });
  assert.match(await fs.readFile(path.join(run.dir, 'index.html'), 'utf8'), /not-started/);
  let integrity = await verifyRun(run.dir);
  assert.equal(integrity.ok, false);
  assert.deepEqual(integrity.errors.filter(error => error.code === 'MISSING_PLANNED_SAMPLE').map(error => error.context), ['baseline', 'variant']);
  assert.deepEqual(integrity.errors.filter(error => error.code === 'INCOMPLETE_SAMPLE').map(error => error.context), ['baseline', 'variant']);
  // verifyRun reports facts only: incomplete is not an integrity failure, and nothing is excused.
  assert.deepEqual([integrity.integrityOk, integrity.complete], [true, false]);
  assert.ok(integrity.errors.every(error => error.category === 'completion'));
  const baseline = await startSample(run, { id: 'baseline', requested: { chars: 40 } });
  await externalSave(baseline);
  await finalizeSample(baseline);
  const partial = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  assert.deepEqual(partial.samples.map(sample => [sample.id, sample.status]), [['baseline', 'saved'], ['variant', 'not-started']]);
  integrity = await verifyRun(run.dir);
  assert.equal(integrity.ok, false);
  assert.ok(integrity.errors.some(error => error.context === 'variant' && error.code === 'MISSING_PLANNED_SAMPLE'));
  partial.samples = partial.samples.filter(sample => sample.id !== 'variant');
  // The source plan remains authoritative even if its copy in the index is removed.
  partial.run.experiment.samples = [{ id: 'baseline' }];
  await fs.writeFile(indexPath, JSON.stringify(partial));
  assert.ok((await verifyRun(run.dir)).errors.some(error => error.context === 'variant' && error.code === 'MISSING_PLANNED_SAMPLE'));
  const variant = await startSample(run, { id: 'variant', requested: { chars: 39 } });
  await externalSave(variant);
  await finalizeSample(variant);
  assert.equal((await verifyRun(run.dir)).ok, true);
});

test('planned sample ids must be safe and unique', async t => {
  for (const samples of [[{ id: '../escape' }], [{ id: 'CON' }], [{}], [{ id: 'duplicate' }, { id: 'duplicate' }]]) {
    await assert.rejects(fixture(t, { samples }), /safe|Duplicate/);
  }
  const run = await fixture(t);
  assert.equal((await verifyRun(run.dir)).ok, true); // A string experiment has no planned sample list.
});

test('completion refuses evidence that disappeared after capture', async t => {
  const run = await fixture(t);
  const sample = await startSample(run, { id: 'missing-proof', requested: { lines: 30 } });
  await externalSave(sample);
  const evidence = await saveEvidence(sample, { screenshots: [PNG], observed: { lines: 30 } });
  await fs.unlink(path.join(sample.dir, evidence.files[0].path));
  const manifest = await finalizeSample(sample, { verification: { passed: true } });
  assert.equal(manifest.status, 'failed');
  assert.equal(manifest.errors[0].code, 'ENOENT');
  assert.equal((await verifyRun(run.dir)).ok, false);
});

test('verifyRun separates integrity from completion and leaves completion unknown without an index', async t => {
  const run = await fixture(t, { name: 'facts', samples: [{ id: 'baseline' }] });
  const sample = await startSample(run, { id: 'baseline', requested: {} });
  await externalSave(sample);
  await finalizeSample(sample);
  assert.deepEqual(await verifyRun(run.dir), { ok: true, checkedSamples: 1, errors: [], integrityOk: true, complete: true });
  await fs.writeFile(sample.documentPath, 'changed after hashing');
  let result = await verifyRun(run.dir);
  assert.deepEqual([result.ok, result.integrityOk, result.complete], [false, false, true]);
  assert.deepEqual(result.errors.map(error => error.category), ['integrity']);
  await fs.rm(path.join(run.dir, 'index.json'));
  result = await verifyRun(run.dir);
  assert.deepEqual([result.ok, result.integrityOk, result.complete], [false, false, null]);
});
