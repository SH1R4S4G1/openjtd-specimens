// References from README/docs are split at the repository/storage boundary.
// Source references must resolve in every clone. Experiment storage references
// (runs, catalogs, observations and local scratch evidence) are checked only by
// the explicit evidence gate, which also re-verifies every documented run.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { verifyRun } from './evidence.mjs';

export const EXPERIMENT_STORAGE_ROOTS = ['runs', 'catalogs', 'observations', 'tmp', 'output'];
export const EXPECTATIONS_FILE = 'evidence-expectations.json';
const RUN_ID = /\b\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}\b/g;
const LINK = /\[[^\]]+\]\(([^\s)]+)\)/g;
const posix = filename => filename.split(path.sep).join('/');

export async function documentationFiles(root) {
  const files = ['README.md'];
  const walk = async directory => {
    for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
      const filename = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(filename);
      else if (entry.name.endsWith('.md')) files.push(filename);
    }
  };
  await walk('docs');
  return files;
}

export function classifyLink(file, link) {
  const target = link.split('#')[0];
  if (!target || /^[a-z]+:/i.test(target)) return { kind: 'external' };
  const relative = posix(path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURIComponent(target))));
  if (relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative)) throw new Error(`${file}: link leaves the repository: ${link}`);
  const kind = EXPERIMENT_STORAGE_ROOTS.includes(relative.split('/')[0]) ? 'evidence' : 'source';
  return { kind, target: relative };
}

export async function collectReferences(root) {
  const files = await documentationFiles(root), source = [], evidence = [], runs = new Map();
  for (const file of files) {
    const markdown = await fs.readFile(path.join(root, file), 'utf8');
    for (const match of markdown.matchAll(LINK)) {
      const reference = classifyLink(file, match[1]);
      if (reference.kind !== 'external') (reference.kind === 'source' ? source : evidence).push({ file, link: match[1], target: reference.target });
    }
    for (const [id] of markdown.matchAll(RUN_ID)) runs.set(id, [...new Set([...(runs.get(id) ?? []), file])]);
  }
  return { files, source, evidence, runs };
}

export async function readExpectations(root) {
  const expectations = JSON.parse(await fs.readFile(path.join(root, EXPECTATIONS_FILE), 'utf8'));
  if (expectations.schemaVersion !== 1 || !expectations.incompleteRuns || typeof expectations.incompleteRuns !== 'object' || Array.isArray(expectations.incompleteRuns)) throw new Error(`${EXPECTATIONS_FILE}: invalid structure.`);
  for (const [id, reason] of Object.entries(expectations.incompleteRuns)) {
    if (!new RegExp(`^${RUN_ID.source}$`).test(id)) throw new Error(`${EXPECTATIONS_FILE}: invalid run id ${id}`);
    if (typeof reason !== 'string' || !reason.trim()) throw new Error(`${EXPECTATIONS_FILE}: ${id} needs a reason.`);
  }
  return expectations;
}

// Portable gate: needs only the tracked source tree.
export async function checkSourceReferences(root) {
  const references = await collectReferences(root);
  for (const { file, link, target } of references.source) {
    try { await fs.access(path.join(root, target)); }
    catch { throw new Error(`${file}: missing source link ${link}`); }
  }
  const ignored = (await fs.readFile(path.join(root, '.gitignore'), 'utf8')).split(/\r?\n/).map(line => line.trim());
  for (const storageRoot of EXPERIMENT_STORAGE_ROOTS) if (!ignored.includes(`${storageRoot}/`)) throw new Error(`.gitignore must exclude experiment storage ${storageRoot}/`);
  const expectations = await readExpectations(root);
  for (const id of Object.keys(expectations.incompleteRuns)) if (!references.runs.has(id)) throw new Error(`${EXPECTATIONS_FILE}: ${id} is not referenced by README/docs.`);
  return { sourceLinks: references.source.length, evidenceLinks: references.evidence.length, runs: references.runs.size };
}

// Evidence gate: needs the experiment storage that holds the documented runs.
// additionalStorages are other experiment storages (for example another
// worktree whose runs/ holds the runs it made): each link and run is
// looked up in storage first, then in each additional one, in order.
export async function checkEvidence({ root, storage = root, additionalStorages = [] }) {
  const references = await collectReferences(root), expectations = await readExpectations(root), errors = [];
  for (const extra of additionalStorages) {
    let directory = false;
    try { directory = (await fs.stat(extra)).isDirectory(); } catch {}
    if (!directory) return { ok: false, storage, additionalStorages, errors: [{ context: extra, code: 'STORAGE_NOT_FOUND', message: `Additional experiment storage ${extra} not found.` }] };
  }
  const locate = async target => {
    for (const candidate of [storage, ...additionalStorages]) { try { await fs.access(path.join(candidate, target)); return candidate; } catch {} }
    return storage;
  };
  // Every storage root the docs rely on must exist; one stray directory (for
  // example an empty tmp/) does not make a checkout an experiment storage.
  const needed = new Set(references.evidence.map(reference => reference.target.split('/')[0]));
  if (references.runs.size) needed.add('runs');
  const absent = [];
  for (const storageRoot of needed) {
    try { if (!(await fs.stat(path.join(storage, storageRoot))).isDirectory()) absent.push(storageRoot); } catch { absent.push(storageRoot); }
  }
  if (absent.length) return { ok: false, storage, errors: [{ context: storage, code: 'STORAGE_NOT_FOUND', message: `Experiment storage ${absent.map(name => `${name}/`).join(', ')} not found under ${storage}. Pass --storage or set ICHITARO_EXPERIMENT_STORAGE.` }] };
  for (const { file, link, target } of references.evidence) {
    try { await fs.access(path.join(await locate(target), target)); }
    catch { errors.push({ context: file, code: 'MISSING_EVIDENCE', message: `Missing evidence link ${link}` }); }
  }
  // Three separate questions per run:
  //   integrity  - observed by verifyRun: recorded artifacts match their hashes
  //   completion - observed by verifyRun: every planned sample finished
  //   acceptance - policy here: may the docs cite this run as evidence?
  // Only a run with intact integrity that is incomplete AND declared in
  // evidence-expectations.json is accepted as known-incomplete history.
  // Batch summaries written by bin/ichitaro-request.mjs cite their runs; a
  // linked summary brings every listed run under the same verification.
  for (const { file, target } of references.evidence.filter(reference => reference.target.endsWith('/execution-results.json'))) {
    let summary;
    try { summary = JSON.parse(await fs.readFile(path.join(await locate(target), target), 'utf8')); } catch { continue; }
    for (const result of summary.results ?? []) {
      const id = typeof result.runDir === 'string' ? path.basename(result.runDir) : null;
      if (id) references.runs.set(id, [...new Set([...(references.runs.get(id) ?? []), `${file} -> ${target}`])]);
    }
  }
  const runs = [];
  for (const [id, referencedBy] of references.runs) {
    const run = `runs/${id}`, reason = expectations.incompleteRuns[id], found = await locate(run);
    const result = await verifyRun(path.join(found, 'runs', id));
    const integrity = result.integrityOk ? 'ok' : 'failed';
    const completion = result.complete === null ? 'unknown' : result.complete ? 'complete' : 'incomplete';
    let acceptance;
    if (integrity === 'failed') {
      acceptance = 'rejected';
      for (const error of result.errors.filter(error => error.category === 'integrity')) errors.push({ run, referencedBy, ...error });
    } else if (completion === 'incomplete' && reason === undefined) {
      acceptance = 'rejected';
      errors.push({ run, referencedBy, category: 'acceptance', code: 'UNDECLARED_INCOMPLETE_RUN', message: `Run is incomplete and not declared in ${EXPECTATIONS_FILE}.`, observed: result.errors });
    } else if (completion === 'complete' && reason !== undefined) {
      acceptance = 'rejected';
      errors.push({ run, referencedBy, category: 'acceptance', code: 'STALE_INCOMPLETE_DECLARATION', message: `${EXPECTATIONS_FILE} declares this run incomplete, but every planned sample completed.` });
    } else acceptance = reason === undefined ? 'accepted' : 'accepted-known-incomplete';
    runs.push({ run, integrity, completion, acceptance, ...(reason === undefined ? {} : { declaredReason: reason }), ...(found === storage ? {} : { storage: found }) });
  }
  const count = (key, value) => runs.filter(entry => entry[key] === value).length;
  return {
    ok: errors.length === 0, storage, ...(additionalStorages.length ? { additionalStorages } : {}), evidenceLinks: references.evidence.length,
    runs: { total: runs.length, integrityFailed: count('integrity', 'failed'), incomplete: count('completion', 'incomplete'), accepted: count('acceptance', 'accepted'), acceptedKnownIncomplete: count('acceptance', 'accepted-known-incomplete'), rejected: count('acceptance', 'rejected') },
    ...(additionalStorages.length ? { runsInAdditionalStorages: runs.filter(entry => entry.storage).map(({ run, storage: found }) => ({ run, storage: found })) } : {}),
    knownIncompleteRuns: runs.filter(entry => entry.acceptance === 'accepted-known-incomplete'),
    rejectedRuns: runs.filter(entry => entry.acceptance === 'rejected'),
    errors,
  };
}
