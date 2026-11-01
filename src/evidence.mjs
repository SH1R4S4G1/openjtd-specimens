import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';

const locks = new Map();
const now = () => new Date().toISOString();
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const errorInfo = error => ({ code: error.code || 'ERROR', message: String(error.message || error) });
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function locked(key, operation) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  locks.set(key, current);
  try { return await current; }
  finally { if (locks.get(key) === current) locks.delete(key); }
}

function validId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(id) || id.includes('..') || id.endsWith('.') || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(id)) {
    throw new Error('Sample id must be a safe, non-reserved ASCII filename (1–80 characters).');
  }
  return id;
}

function plannedSamples(experiment) {
  if (!Array.isArray(experiment?.samples)) return [];
  const ids = new Set();
  return experiment.samples.map(spec => {
    const id = validId(spec?.id);
    if (ids.has(id)) throw new Error(`Duplicate planned sample id: ${id}`);
    ids.add(id);
    return { id, requested: { ...spec.settings,...(spec.footnote?{footnote:spec.footnote}:{}),...(spec.namedStyle?{namedStyle:spec.namedStyle}:{}),...(spec.headerSteps!==undefined?{headerSteps:spec.headerSteps,headerPages:spec.headerPages,headerPosition:spec.headerPosition}:{}), ...(spec.documentColumns!==undefined?{documentColumns:spec.documentColumns}:{}), ...(spec.features ? { features: spec.features } : {}), ...(spec.layoutPriority ? { layoutPriority: spec.layoutPriority } : {}), ...(experiment.targets ? {targets:experiment.targets,operations:spec.operations??[]} : {}), ...(experiment.keisenCanvas ? {keisenCanvas:experiment.keisenCanvas,keisenOperations:spec.keisenOperations??[]} : {}), ...(experiment.paragraphTargets ? {paragraphTargets:experiment.paragraphTargets,paragraphOperations:spec.paragraphOperations??[]} : {}) } };
  });
}

// Windows can briefly deny replacing a file that another process (indexer,
// antivirus, a report viewer) has open. Retry only those transient codes.
const TRANSIENT_RENAME = new Set(['EPERM', 'EACCES', 'EBUSY']);
async function renameWithRetry(from, to, attempts = 10) {
  for (let attempt = 1; ; attempt++) {
    try { return await fs.rename(from, to); }
    catch (error) {
      if (!TRANSIENT_RENAME.has(error.code) || attempt >= attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 * attempt));
    }
  }
}

async function atomicWrite(filename, data, exclusive = false) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const claim = `${filename}.writing`;
  let claimed = false;
  try {
    if (exclusive) {
      // A directory claim works on Windows without hard-link privileges and
      // prevents concurrent package writers from replacing the same artifact.
      await fs.mkdir(claim);
      claimed = true;
      try { await fs.lstat(filename); throw Object.assign(new Error(`Artifact already exists: ${filename}`), { code: 'EEXIST' }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await fs.writeFile(temporary, data, { flag: 'wx' });
    await renameWithRetry(temporary, filename);
  } finally {
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (claimed) await fs.rmdir(claim);
  }
}

async function readJson(filename) { return JSON.parse(await fs.readFile(filename, 'utf8')); }

// Every artifact reference is relative, and existing symlinks are refused.
async function artifactPath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.includes(':') || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe artifact path: ${relative}`);
  }
  let result = path.resolve(root);
  for (const part of relative.split('/')) {
    result = path.join(result, part);
    const stat = await fs.lstat(result);
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not evidence: ${relative}`);
  }
  return result;
}

async function hashArtifact(root, relative, kind) {
  const filename = await artifactPath(root, relative);
  const before = await fs.stat(filename);
  if (!before.isFile()) throw new Error(`Artifact is not a regular file: ${relative}`);
  const data = await fs.readFile(filename);
  const after = await fs.stat(filename);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error(`Artifact changed while hashing: ${relative}`);
  return { path: relative, kind, bytes: data.length, sha256: sha256(data) };
}

async function activeState(sample) {
  try { await fs.access(path.join(sample.dir, 'manifest.json')); throw new Error('Sample is already complete; evidence cannot be overwritten.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return readJson(path.join(sample.dir, 'sample.json'));
}

export async function createRun({ outputRoot, experiment, environment = {}, source = {} }) {
  if (!outputRoot || !experiment) throw new Error('outputRoot and experiment are required.');
  plannedSamples(experiment);
  const id = `${now().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const dir = path.resolve(outputRoot, id);
  await fs.mkdir(path.resolve(outputRoot), { recursive: true });
  await fs.mkdir(dir);
  await fs.mkdir(path.join(dir, 'samples'));
  const metadata = clone({ schemaVersion: 1, id, createdAt: now(), experiment, environment, source });
  await atomicWrite(path.join(dir, 'run.json'), json(metadata), true);
  await atomicWrite(path.join(dir, 'events.json'), json([]), true);
  const run = { id, dir };
  await updateReport(run);
  return run;
}

export async function startSample(run, { id, requested, baseline = null }) {
  validId(id);
  if (!requested || typeof requested !== 'object' || Array.isArray(requested)) throw new Error('requested must be an object describing the requested settings.');
  const dir = path.join(run.dir, 'samples', id);
  await fs.mkdir(dir); // EEXIST intentionally rejects sample reuse.
  await fs.mkdir(path.join(dir, 'evidence'));
  const sample = { id, dir, runDir: run.dir, documentPath: path.join(dir, 'document.jtd') };
  await atomicWrite(path.join(dir, 'sample.json'), json({ schemaVersion: 1, id, createdAt: now(), requested: clone(requested), baseline: clone(baseline), evidence: [] }), true);
  await appendEvent(run, { type: 'sample-started', sampleId: id });
  await updateReport(run);
  return sample;
}

export async function appendEvent(run, event) {
  return locked(`${run.dir}:events`, async () => {
    const filename = path.join(run.dir, 'events.json');
    const events = await readJson(filename);
    const entry = { sequence: events.length + 1, at: now(), event: clone(event) };
    events.push(entry);
    await atomicWrite(filename, json(events));
    return entry;
  });
}

export async function saveMacroEvidence(sample, { label, phase, observed, verification, macroSource, resultBytes }) {
  return locked(sample.dir, async () => {
    const state = await activeState(sample);
    if (typeof macroSource !== 'string' || !macroSource.length || /[^\x00-\x7f]/.test(macroSource)) throw new Error('macroSource must be a nonempty ASCII string.');
    if (!(resultBytes instanceof Uint8Array) || !resultBytes.byteLength || resultBytes.byteLength % 2 !== 0) throw new Error('resultBytes must be nonempty raw UTF-16LE Uint8Array bytes.');
    if (observed !== undefined && (!observed || typeof observed !== 'object' || Array.isArray(observed))) throw new Error('observed must be an object containing actual macro readings.');
    const readings = clone({ observed, verification });
    const source = Buffer.from(macroSource, 'ascii');
    const result = Buffer.from(resultBytes);
    const number = String(state.evidence.length + 1).padStart(4, '0');
    const files = [];
    for (const [kind, extension, encoding, bytes] of [['macro-source', 'txt', 'ascii', source], ['macro-result', 'txt', 'utf-16le', result]]) {
      const relative = `evidence/${number}-${kind}.${extension}`;
      await atomicWrite(path.join(sample.dir, relative), bytes, true);
      files.push({ ...await hashArtifact(sample.dir, relative, kind), encoding });
    }
    const entry = { id: number, label: label ?? '', phase: phase ?? '', method: 'macro-getter', capturedAt: now(), files, ...readings };
    state.evidence.push(entry);
    await atomicWrite(path.join(sample.dir, 'sample.json'), json(state));
    await appendEvent({ dir: sample.runDir }, { type: 'evidence-captured', sampleId: sample.id, evidenceId: number, method: 'macro-getter' });
    return clone(entry);
  });
}

function macroReadbackProof(evidence, proof) {
  const isGetter = entry => entry.method === 'macro-getter' && entry.observed && Object.keys(entry.observed).length > 0
    && ['macro-source', 'macro-result'].every(kind => entry.files.filter(file => file.kind === kind && file.bytes > 0).length === 1);
  const before = evidence.findIndex(entry => entry.phase === 'before-save' && isGetter(entry));
  return before >= 0 && evidence.some((entry, index) => index > before && entry.phase === 'reopened' && isGetter(entry)
    && entry.verification?.passed === true && entry.verification?.reopened === true && entry.verification?.method === 'macro-getter')
    && proof?.passed === true && proof?.reopened === true && proof?.method === 'macro-getter';
}

async function stableDocument(sample, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error('timeoutMs must be nonnegative.');
  const deadline = Date.now() + timeoutMs;
  let previous;
  let stableSince;
  let lastError = new Error('Document did not become stable before the deadline.');
  do {
    try {
      const filename = await artifactPath(sample.dir, 'document.jtd');
      const stat = await fs.stat(filename);
      if (!stat.isFile() || stat.size === 0) throw new Error('document.jtd must be a nonempty regular file.');
      const signature = `${stat.size}:${stat.mtimeMs}:${stat.ino}`;
      if (signature !== previous) { previous = signature; stableSince = Date.now(); }
      else if (Date.now() - stableSince >= 200) return await hashArtifact(sample.dir, 'document.jtd', 'document');
    } catch (error) { lastError = error; previous = undefined; }
    if (Date.now() >= deadline) break;
    await sleep(Math.min(100, deadline - Date.now()));
  } while (Date.now() <= deadline);
  lastError.code ||= 'DOCUMENT_NOT_STABLE';
  throw lastError;
}

async function complete(sample, state, fields) {
  const manifest = { ...state, ...fields, completedAt: now() };
  await atomicWrite(path.join(sample.dir, 'manifest.json'), json(manifest), true);
  await appendEvent({ dir: sample.runDir }, { type: 'sample-completed', sampleId: sample.id, status: manifest.status });
  await updateReport({ dir: sample.runDir });
  return manifest;
}

export async function finalizeSample(sample, { expectedTitle, actualTitle, verification, timeoutMs = 5000 } = {}) {
  return locked(sample.dir, async () => {
    const state = await activeState(sample);
    let document;
    try { document = await stableDocument(sample, timeoutMs); }
    catch (error) { return complete(sample, state, { status: 'failed', document: null, errors: [errorInfo(error)], verification: { passed: false } }); }
    try {
      for (const entry of state.evidence) for (const artifact of entry.files) {
        const actual = await hashArtifact(sample.dir, artifact.path, artifact.kind);
        if (actual.sha256 !== artifact.sha256 || actual.bytes !== artifact.bytes) throw new Error(`Evidence changed after capture: ${artifact.path}`);
      }
    } catch (error) { return complete(sample, state, { status: 'failed', document, errors: [errorInfo(error)], verification: { passed: false } }); }
    const observed = state.evidence.reduce((result, entry) => ({ ...result, ...entry.observed }), {});
    const proof = clone(verification ?? state.evidence.at(-1)?.verification ?? { passed: false });
    const titleMatches = expectedTitle === undefined || (actualTitle !== undefined && expectedTitle === actualTitle);
    // Only macro getter readback before save and after reopen establishes verified.
    const hasMacroReadback = macroReadbackProof(state.evidence, proof);
    const verified = proof?.passed === true && titleMatches && hasMacroReadback && Object.keys(observed).length > 0;
    return complete(sample, state, {
      status: verified ? 'verified' : 'saved', document, observed,
      verification: { ...proof, passed: verified, assertedPassed: proof?.passed === true, titleMatches, hasMacroReadback, hasObservedSettings: Object.keys(observed).length > 0 },
      ...(expectedTitle !== undefined ? { expectedTitle } : {}), ...(actualTitle !== undefined ? { actualTitle } : {}), errors: [],
    });
  });
}

export async function failSample(sample, error) {
  return locked(sample.dir, async () => {
    const state = await activeState(sample);
    let document = null;
    try { document = await hashArtifact(sample.dir, 'document.jtd', 'document'); } catch { /* Failure may precede save. */ }
    return complete(sample, state, { status: 'failed', document, errors: [errorInfo(error)], verification: { passed: false } });
  });
}

async function updateReport(run) {
  return locked(`${run.dir}:report`, async () => {
    const metadata = await readJson(path.join(run.dir, 'run.json'));
    const samples = [];
    const directories = await fs.readdir(path.join(run.dir, 'samples'), { withFileTypes: true });
    for (const entry of directories.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const relative = `samples/${entry.name}/manifest.json`;
      let manifest;
      try { manifest = await readJson(await artifactPath(run.dir, relative)); }
      catch (error) { if (error.code === 'ENOENT') { samples.push({ id: entry.name, status: 'pending' }); continue; } throw error; }
      samples.push({ id: manifest.id, status: manifest.status, requested: manifest.requested, observed: manifest.observed ?? {}, verification: manifest.verification, errors: manifest.errors, manifest: await hashArtifact(run.dir, relative, 'manifest'), document: manifest.document, evidence: manifest.evidence });
    }
    for (const planned of plannedSamples(metadata.experiment)) {
      if (!samples.some(sample => sample.id === planned.id)) samples.push({ ...planned, status: 'not-started' });
    }
    const index = { schemaVersion: 1, updatedAt: now(), run: metadata, samples };
    await atomicWrite(path.join(run.dir, 'index.json'), json(index));
    const rows = samples.map(sample => {
      const base = `samples/${encodeURIComponent(sample.id)}/`;
      const proof=sample.verification?.rangeProof??sample.verification?.keisenProof??sample.verification?.paragraphProof??sample.verification?.columnProof??sample.verification?.headerProof??sample.verification?.namedStyleProof??sample.verification?.footnoteProof??sample.verification?.frameProof??sample.verification?.headerLayoutProof??sample.verification?.styleProof;
      const bodyNotes=sample.verification?.bodyComparison?`<details><summary>本文の比較方法</summary><pre>${escapeHtml(JSON.stringify({bodyComparison:sample.verification.bodyComparison,bodyComparisonDetails:sample.verification.bodyComparisonDetails},null,2))}</pre></details>`:'';
      const verificationNotes=bodyNotes+(proof?`<p>${proof.checks.some(c=>c.widthVerified===false)?'均等幅：未検証（専用getterによる有無のみ）':''}</p><p>${proof.getterDisagreements?.length?`getter間の不一致：${proof.getterDisagreements.length}件。生データと詳細をmanifestに記録。`:''}</p><details><summary>検証の強さ・制限</summary><pre>${escapeHtml(JSON.stringify({strength:proof.strength,reviewRequired:proof.reviewRequired,decorationVerified:proof.decorationVerified,coverage:proof.coverage,bodyComparison:sample.verification.bodyComparison,checks:proof.checks,limitations:proof.limitations},null,2))}</pre></details>`:'');
      const evidenceLinks = (sample.evidence ?? []).flatMap(e => e.files.filter(f => ['macro-source', 'macro-result'].includes(f.kind)).map(f => `<a href="${base}${f.path.split('/').map(encodeURIComponent).join('/')}">${escapeHtml(e.label || e.phase || f.kind)} (${escapeHtml(f.kind)})</a>`)).join(' · ');
      return `<tr><td>${escapeHtml(sample.id)}</td><td>${escapeHtml(sample.status)}${verificationNotes}</td><td><pre>${escapeHtml(JSON.stringify(sample.requested ?? {}, null, 2))}</pre></td><td><pre>${escapeHtml(JSON.stringify(sample.observed ?? {}, null, 2))}</pre></td><td>${sample.document ? `<a href="${base}document.jtd">JTD</a> · ` : ''}${sample.manifest ? `<a href="${base}manifest.json">manifest</a>` : ''}<br>${evidenceLinks}<pre>${escapeHtml(JSON.stringify(sample.errors ?? []))}</pre></td></tr>`;
    }).join('\n');
    await atomicWrite(path.join(run.dir, 'index.html'), `<!doctype html><html lang="ja"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>一太郎 試料レポート</title><style>body{font:15px system-ui;margin:2rem;color:#172134}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd2dd;padding:.7rem;vertical-align:top;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#1757b8}</style><h1>一太郎 試料レポート</h1><p>${escapeHtml(typeof metadata.experiment === 'string' ? metadata.experiment : JSON.stringify(metadata.experiment))}</p><p>saved: ファイル保存・ハッシュ確認済み / verified: 観測結果と検証記録あり / failed: 失敗 / pending: 未完了 / not-started: 未開始</p><table><thead><tr><th>試料</th><th>状態</th><th>要求した設定</th><th>観測した設定</th><th>証跡</th></tr></thead><tbody>${rows}</tbody></table></html>\n`);
    return index;
  });
}

// Codes that only observe that planned samples did not finish. Every other
// error is an integrity failure of the recorded run. verifyRun reports facts;
// whether an incomplete run is acceptable is decided by callers (evidence gate).
const COMPLETION_CODES = new Set(['MISSING_PLANNED_SAMPLE', 'INCOMPLETE_SAMPLE']);

export async function verifyRun(runDir) {
  const { completionUnknown, ...result } = await inspectRun(runDir);
  const errors = result.errors.map(error => ({ category: COMPLETION_CODES.has(error.code) ? 'completion' : 'integrity', ...error }));
  // complete is null when the run index/plan cannot be read, so completion was not observed.
  return { ...result, errors, integrityOk: errors.every(error => error.category !== 'integrity'), complete: completionUnknown ? null : errors.every(error => error.category !== 'completion') };
}

async function inspectRun(runDir) {
  const errors = [];
  const check = async (root, artifact, context) => {
    try {
      if (!artifact || typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) throw new Error('Invalid artifact hash record.');
      const actual = await hashArtifact(root, artifact.path, artifact.kind);
      if (actual.sha256 !== artifact.sha256 || actual.bytes !== artifact.bytes) throw new Error(`Hash/size mismatch: ${artifact.path}`);
    } catch (error) { errors.push({ context, ...errorInfo(error) }); }
  };
  let index;
  let planned;
  try {
    index = await readJson(path.join(runDir, 'index.json'));
    if (index.schemaVersion !== 1 || !Array.isArray(index.samples)) throw new Error('Invalid run index.');
  } catch (error) { return { ok: false, errors: [{ context: 'index.json', ...errorInfo(error) }], checkedSamples: 0, completionUnknown: true }; }
  try { planned = plannedSamples((await readJson(path.join(runDir, 'run.json'))).experiment); }
  catch (error) { return { ok: false, errors: [{ context: 'run.json', ...errorInfo(error) }], checkedSamples: 0, completionUnknown: true }; }
  for (const sample of planned) {
    if (!index.samples.some(entry => entry.id === sample.id && entry.status !== 'not-started')) errors.push({ context: sample.id, code: 'MISSING_PLANNED_SAMPLE', message: 'Planned sample has not started or is missing from the run index.' });
  }
  for (const sample of index.samples) {
    try {
      validId(sample.id);
      if (sample.status === 'pending' || sample.status === 'not-started') throw Object.assign(new Error('Sample has not completed.'), { code: 'INCOMPLETE_SAMPLE' });
      const relative = `samples/${sample.id}/manifest.json`;
      if (sample.manifest?.path !== relative) throw new Error('Manifest path does not match sample id.');
      await check(runDir, sample.manifest, sample.id);
      const manifest = await readJson(await artifactPath(runDir, relative));
      if (manifest.schemaVersion !== 1 || manifest.id !== sample.id || !['saved', 'verified', 'failed'].includes(manifest.status) || manifest.status !== sample.status || !manifest.completedAt || !Array.isArray(manifest.evidence)) throw new Error('Invalid sample manifest.');
      const root = path.join(runDir, 'samples', sample.id);
      if (manifest.status !== 'failed' && manifest.document?.path !== 'document.jtd') throw new Error('Completed sample has no JTD document.');
      if (manifest.document) await check(root, manifest.document, sample.id);
      for (const entry of manifest.evidence) {
        if (!Array.isArray(entry.files)) throw new Error('Invalid evidence entry.');
        for (const artifact of entry.files) await check(root, artifact, sample.id);
      }
    } catch (error) { errors.push({ context: sample.id, ...errorInfo(error) }); }
  }
  try {
    const entries = await fs.readdir(path.join(runDir, 'samples'), { withFileTypes: true });
    for (const entry of entries) if (entry.isDirectory() && !index.samples.some(s => s.id === entry.name)) errors.push({ context: entry.name, code: 'UNINDEXED_SAMPLE', message: 'Sample directory is missing from the run index.' });
  } catch (error) { errors.push({ context: 'samples', ...errorInfo(error) }); }
  return { ok: errors.length === 0, checkedSamples: index.samples.length, errors };
}

