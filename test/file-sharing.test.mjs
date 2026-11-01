import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileRetry } from '../src/file-retry.mjs';
import { MacroAdapter } from '../src/adapters/macro.mjs';
import { checkStaleLock, releaseStaleLock, lockState } from '../src/lock-recovery.mjs';
import { CFB_SIGNATURE } from '../src/cfb.mjs';
import { runPdfCatalog } from '../src/pdf-catalog.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const utf16 = value => Buffer.from('﻿' + value, 'utf16le');
const busy = code => Object.assign(new Error(`${code}: resource busy or locked, read`), { code });
const exists = file => fs.access(file).then(() => true, () => false);
const fakePdf = Buffer.from('%PDF-1.5\n1 0 obj<</Type/Pages/Kids[]/Count 1>>endobj\n2 0 obj<</Type/Page/Parent 1 0 R>>endobj\n%%EOF\n');
async function scratch(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ichitaro-sharing-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('readFileRetry retries Windows sharing violations up to the limit and returns other errors at once', async () => {
  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    let calls = 0;
    const read = async () => { if (++calls < 4) throw busy(code); return 'bytes'; };
    assert.equal(await readFileRetry('x', 'utf8', { read, intervalMs: 1 }), 'bytes');
    assert.equal(calls, 4, code);
  }
  await assert.rejects(readFileRetry('x', 'utf8', { read: async () => { throw busy('EBUSY'); }, limitMs: 30, intervalMs: 5 }), error => error.code === 'EBUSY' && error.retriedMs >= 30);
  let calls = 0;
  await assert.rejects(readFileRetry('x', 'utf8', { read: async () => { calls++; throw Object.assign(new Error('gone'), { code: 'ENOENT' }); } }), { code: 'ENOENT' });
  assert.equal(calls, 1);
});

// A launch that plays Ichitaro for exportPdf (not an existing JTD): PDF, result, marker.
function launchWriting(pdfPath, { never = false } = {}) {
  return async (_exe, macroPath) => {
    if (never) return { pid: 1 };
    const source = await fs.readFile(macroPath, 'ascii'), dir = path.dirname(macroPath), nonce = /nonce=([0-9a-f-]{36})/.exec(source)[1];
    await fs.writeFile(pdfPath, fakePdf);
    await fs.writeFile(path.join(dir, 'result.txt'), utf16(`nonce=${nonce}\r\nstatus=ok\r\n`));
    await fs.writeFile(path.join(dir, 'done.txt'), nonce);
    return { pid: 1 };
  };
}
async function pdfJob(t) {
  const dir = await scratch(t), exe = path.join(dir, 'fake.exe'), jtd = path.join(dir, 'a.jtd');
  await fs.writeFile(exe, 'fake'); await fs.writeFile(jtd, Buffer.concat([CFB_SIGNATURE, Buffer.from(' a')]));
  return { dir, exe, jtd, lockPath: path.join(dir, 'runner.lock'), pdf: path.join(dir, 'a.pdf'), workDir: path.join(dir, 'a.macro') };
}

test('a sharing violation on the completion marker or a result file is "not yet", not an unknown outcome (mun-147661)', async t => {
  const job = await pdfJob(t);
  const counts = {};
  // Ichitaro still holds done.txt for three polls and result.txt for two reads, as on 2026-10-19.
  const readFile = async (file, encoding) => {
    const name = path.basename(file); counts[name] = (counts[name] ?? 0) + 1;
    if ((name === 'done.txt' && counts[name] <= 3 && await exists(file)) || (name === 'result.txt' && counts[name] <= 2)) throw busy(name === 'done.txt' ? 'EBUSY' : 'EPERM');
    return fs.readFile(file, encoding);
  };
  const adapter = new MacroAdapter({ exe: job.exe, lockPath: job.lockPath, launch: launchWriting(job.pdf), timeoutMs: 5000, readFile, processRunning: () => false, lockContext: { catalogId: 'municipal' } });
  const pdf = await adapter.exportPdf({ jtd: job.jtd, pdf: job.pdf, workDir: job.workDir });
  assert.equal(pdf.sha256, sha256(fakePdf));
  assert.equal(adapter.uncertain, false);
  assert.equal(await exists(job.lockPath), false);
  assert.ok(counts['done.txt'] >= 4 && counts['result.txt'] >= 3);
});

test('the two unknown outcomes keep the lock with the job, the context and the reason in it', async t => {
  // 1. No completion marker within the time limit.
  const a = await pdfJob(t);
  const timedOut = new MacroAdapter({ exe: a.exe, lockPath: a.lockPath, launch: launchWriting(a.pdf, { never: true }), timeoutMs: 1000, processRunning: () => false, lockContext: { catalogId: 'municipal' } });
  await assert.rejects(timedOut.exportPdf({ jtd: a.jtd, pdf: a.pdf, workDir: a.workDir, context: { documentId: 'mun-1' } }), { code: 'ERR_MACRO_TIMEOUT' });
  assert.equal(timedOut.uncertain, true);
  const lock = JSON.parse(await fs.readFile(a.lockPath, 'utf8'));
  assert.deepEqual([lock.kind, lock.pdf, lock.donePath, lock.uncertain, lock.code, lock.context], ['pdf', a.pdf, path.join(a.workDir, 'done.txt'), true, 'ERR_MACRO_TIMEOUT', { catalogId: 'municipal', documentId: 'mun-1' }]);
  assert.match(lock.nonce, /^[0-9a-f-]{36}$/);
  assert.match(lock.reason, /timed out/);
  // 2. The marker came, but Ichitaro is still running after exitLimitMs.
  // No Ichitaro before the macro is dispatched (0.21.0 would refuse one), one left after it.
  const b = await pdfJob(t), afterB = { launched: false };
  const lingering = new MacroAdapter({ exe: b.exe, lockPath: b.lockPath, launch: async (...launch) => { afterB.launched = true; return launchWriting(b.pdf)(...launch); }, timeoutMs: 5000, exitLimitMs: 300, processRunning: () => afterB.launched });
  await assert.rejects(lingering.exportPdf({ jtd: b.jtd, pdf: b.pdf, workDir: b.workDir }), { code: 'ERR_ICHITARO_STILL_RUNNING' });
  assert.equal(lingering.uncertain, true);
  assert.equal(JSON.parse(await fs.readFile(b.lockPath, 'utf8')).code, 'ERR_ICHITARO_STILL_RUNNING');
  await assert.rejects(lingering.exportPdf({ jtd: b.jtd, pdf: path.join(b.dir, 'b.pdf'), workDir: path.join(b.dir, 'b.macro') }), /unknown outcome/);
});

test('at start a lock is released only when the marker, the result, the process and the PDF all check out', async t => {
  const job = await pdfJob(t), after = { launched: false };
  const adapter = new MacroAdapter({ exe: job.exe, lockPath: job.lockPath, launch: async (...launch) => { after.launched = true; return launchWriting(job.pdf)(...launch); }, timeoutMs: 5000, exitLimitMs: 300, processRunning: () => after.launched });
  await assert.rejects(adapter.exportPdf({ jtd: job.jtd, pdf: job.pdf, workDir: job.workDir }), { code: 'ERR_ICHITARO_STILL_RUNNING' });
  const options = { stableMs: 20 };
  // Ichitaro is still there: kept.
  let result = await releaseStaleLock(job.lockPath, { ...options, processRunning: () => true });
  assert.deepEqual([result.released, result.checks.find(check => check.name === 'no-ichitaro-process').ok], [false, false]);
  // The PDF changes while it is checked: kept.
  const writing = setTimeout(() => fs.appendFile(job.pdf, ' more'), 5);
  result = await checkStaleLock(job.lockPath, { stableMs: 60, processRunning: () => false });
  clearTimeout(writing);
  assert.equal(result.checks.find(check => check.name === 'stable:a.pdf').ok, false);
  // An incomplete marker: kept.
  const done = await fs.readFile(path.join(job.workDir, 'done.txt'), 'ascii');
  await fs.writeFile(path.join(job.workDir, 'done.txt'), done.slice(0, 10));
  result = await releaseStaleLock(job.lockPath, { ...options, processRunning: () => false });
  assert.deepEqual([result.released, result.checks.find(check => check.name === 'marker-complete').ok], [false, false]);
  assert.ok(await exists(job.lockPath));
  // Everything checks out: released, with the lock returned for the record.
  await fs.writeFile(path.join(job.workDir, 'done.txt'), done);
  result = await releaseStaleLock(job.lockPath, { ...options, processRunning: () => false });
  assert.equal(result.released, true, JSON.stringify(result.checks));
  assert.ok(result.checks.every(check => check.ok));
  assert.equal(result.lock.code, 'ERR_ICHITARO_STILL_RUNNING');
  assert.equal(await exists(job.lockPath), false);
  assert.deepEqual(await checkStaleLock(job.lockPath, { processRunning: () => false }), { present: false });
});

test('a 0.17.0 lock (pid, createdAt, pdf only) is checked through the job folder next to the PDF', async t => {
  const dir = await scratch(t), pdf = path.join(dir, 'pdf', 'mun-147661.pdf'), work = path.join(dir, 'pdf', 'mun-147661.macro'), lockPath = path.join(dir, 'old.lock');
  const nonce = 'a10ad162-9ba5-4c67-b641-c91d5922bff9';
  await fs.mkdir(work, { recursive: true });
  await fs.writeFile(pdf, fakePdf);
  await fs.writeFile(path.join(work, 'runner.txt'), `%result.LinePrint("nonce=${nonce}")\r\n`);
  await fs.writeFile(path.join(work, 'result.txt'), utf16(`nonce=${nonce}\r\nsheets=1\r\ndocumentMacros=0\r\nstatus=ok\r\n`));
  await fs.writeFile(path.join(work, 'done.txt'), nonce);
  await fs.writeFile(lockPath, JSON.stringify({ pid: 10484, createdAt: '2026-10-19T01:10:09.428Z', pdf }));
  const state = await lockState(lockPath, { workRoot: path.dirname(dir) });
  assert.deepEqual([state.present, state.createdAt, state.catalogId, state.uncertain], [true, '2026-10-19T01:10:09.428Z', path.basename(dir), false]);
  const result = await releaseStaleLock(lockPath, { stableMs: 10, processRunning: () => false });
  assert.equal(result.released, true, JSON.stringify(result.checks));
  assert.deepEqual(await lockState(lockPath), { present: false });
  assert.equal(state.documentId, 'mun-147661');
});

// In-process adapter for the runner: per document, ok, a file still held after the
// retries (FILE_BUSY), Ichitaro still running (unknown) or a timeout (unknown).
function planAdapter(plan) {
  const calls = [];
  return { calls,
    async exportPdf({ jtd, pdf, workDir }) {
      const id = path.basename(jtd, '.jtd'), action = plan[id] ?? 'ok', before = sha256(await fs.readFile(jtd));
      calls.push(id);
      await fs.mkdir(workDir); await fs.writeFile(path.join(workDir, 'runner.txt'), `macro for ${id}`);
      if (action === 'timeout') throw Object.assign(new Error('PDF export timed out; inspect the application before recovery.'), { code: 'ERR_MACRO_TIMEOUT' });
      if (action === 'still') throw Object.assign(new Error('Ichitaro was still running 60000ms after the macro finished; inspect the application before recovery.'), { code: 'ERR_ICHITARO_STILL_RUNNING' });
      if (action === 'busy') throw Object.assign(busy('EBUSY'), { retriedMs: 15000, jtdSha256: before, jtdSha256AfterClose: before });
      await fs.writeFile(path.join(workDir, 'result.txt'), utf16(`result for ${id}`));
      await fs.writeFile(pdf, fakePdf);
      return { path: pdf, bytes: fakePdf.length, sha256: sha256(fakePdf), pages: 1, jtdSha256: before, jtdSha256AfterClose: before, jtdUnchanged: true, durationMs: 5, exitWaitMs: 7, sheets: 1, documentMacros: 0, macro: {}, sheetPdfs: [] };
    } };
}
async function catalogWith(dir, count) {
  await fs.mkdir(path.join(dir, 'inputs'), { recursive: true });
  const documents = [];
  for (let i = 0; i < count; i++) {
    const bytes = Buffer.concat([CFB_SIGNATURE, Buffer.from(` doc ${i}`)]);
    await fs.writeFile(path.join(dir, 'inputs', `${i}.jtd`), bytes);
    documents.push({ id: `doc-${i}`, file: `inputs/${i}.jtd`, sha256: sha256(bytes) });
  }
  return { schemaVersion: 1, kind: 'pdf-from-jtd', id: 'municipal', documents };
}

test('FILE_BUSY continues; ICHITARO_STILL_RUNNING stops; a resumed run carries over every outcome and runs only the rest', async t => {
  const dir = await scratch(t), catalog = await catalogWith(dir, 8);
  const first = await runPdfCatalog(catalog, dir, path.join(dir, 'out-1'), { adapter: planAdapter({ 'doc-2': 'busy', 'doc-5': 'still' }), windows: () => ({ windows: [] }) });
  assert.deepEqual(first.results.map(result => result.outcome), ['PDF_SAVED', 'PDF_SAVED', 'FILE_BUSY', 'PDF_SAVED', 'PDF_SAVED', 'ICHITARO_STILL_RUNNING']);
  assert.deepEqual(first.counts, { VERIFIED: 4, NOT_VERIFIED: 1, TIMEOUT_UNKNOWN_OUTCOME: 1 });
  assert.equal(first.results[0].exitWaitMs, 7);
  assert.deepEqual(first.stopped, { documentId: 'doc-5', outcome: 'ICHITARO_STILL_RUNNING', message: 'Ichitaro was still running 60000ms after the macro finished; inspect the application before recovery.' });
  // Resume (attempt 2): the five documents with an outcome stay as they were; doc-5 to doc-7 run.
  const adapter = planAdapter({ 'doc-6': 'timeout' });
  const second = await runPdfCatalog(catalog, dir, path.join(dir, 'out-2'), { adapter, resume: first, windows: () => ({ windows: [] }) });
  assert.deepEqual(adapter.calls, ['doc-5', 'doc-6']);
  assert.deepEqual(second.results.map(result => [result.documentId, result.outcome, result.carriedOver?.fromAttempt ?? null]),
    [['doc-0', 'PDF_SAVED', 1], ['doc-1', 'PDF_SAVED', 1], ['doc-2', 'FILE_BUSY', 1], ['doc-3', 'PDF_SAVED', 1], ['doc-4', 'PDF_SAVED', 1], ['doc-5', 'PDF_SAVED', null], ['doc-6', 'TIMEOUT_UNKNOWN_OUTCOME', null]]);
  assert.deepEqual(second.resumed, { attempt: 2, carriedOver: 5, previousStopped: first.stopped });
  assert.equal(second.results[0].pdf.path, first.results[0].pdf.path); // carried records keep their paths and hashes
  // Attempt 3 runs doc-6 and doc-7 and completes; carried documents keep the attempt they came from.
  const third = await runPdfCatalog(catalog, dir, path.join(dir, 'out-3'), { adapter: planAdapter({}), resume: second });
  assert.equal(third.results.length, 8);
  assert.deepEqual(third.resumed.attempt, 3);
  assert.deepEqual([third.results[0].carriedOver, third.results[5].carriedOver, third.results[7].carriedOver], [{ fromAttempt: 1 }, { fromAttempt: 2 }, undefined]);
  assert.equal(third.ok, false); // doc-2 has no PDF
  assert.equal(third.stopped, null);
  await assert.rejects(runPdfCatalog({ ...catalog, id: 'other' }, dir, path.join(dir, 'out-4'), { adapter: planAdapter({}), resume: second }), { code: 'ERR_RESUME_MISMATCH' });
});
