// A component for callers that run catalogs unattended. A MacroAdapter lock left
// by an unknown outcome stops such a caller until someone has looked. The caller
// may look mechanically at its start (0.17.1):
// the lock is released only when the macro's completion marker is complete (the
// job's nonce), its result file is complete, no Ichitaro process is running and
// the files the job wrote (the PDF, or the sample JTD) exist with a hash that
// stays the same over stableMs. Otherwise the lock stays for a person.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileRetry } from './file-retry.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const exists = file => fs.access(file).then(() => true, () => false);

async function readText(file, encoding) {
  try { return await readFileRetry(file, encoding, { limitMs: 3000 }); } catch { return null; }
}

// The job a lock names. Locks from 0.17.1 carry donePath, resultPath, nonce and the
// files written; older ones carry only pdf (PDF export, workDir <pdf>.macro next to
// it as bin/ichitaro-pdf.mjs and --pdf name it) or sampleDir (workDir <sampleDir>/macro).
export async function lockJob(lock) {
  if (lock.donePath && lock.nonce) {
    const files = lock.kind === 'sample' ? [lock.output] : [lock.pdf];
    return { donePath: lock.donePath, resultPath: lock.resultPath ?? path.join(path.dirname(lock.donePath), 'result.txt'), nonce: lock.nonce, files, required: lock.kind !== 'sample' };
  }
  const workDir = lock.pdf ? lock.pdf.replace(/\.pdf$/i, '.macro') : lock.sampleDir ? path.join(lock.sampleDir, 'macro') : null;
  if (!workDir) return null;
  const nonce = /nonce=([0-9a-f-]{36})/.exec((await readText(path.join(workDir, 'runner.txt'), 'ascii')) ?? '')?.[1] ?? null;
  return { donePath: path.join(workDir, 'done.txt'), resultPath: path.join(workDir, 'result.txt'), nonce, files: [lock.pdf ?? path.join(lock.sampleDir, 'document.jtd')], required: !!lock.pdf };
}

/**
 * Check a lock. Returns { present: false } without a lock, otherwise { present,
 * ok, lock, checks: [{ name, ok, detail }] }. processRunning is MacroAdapter's.
 */
export async function checkStaleLock(lockPath, { processRunning, stableMs = 5000 } = {}) {
  const raw = await readText(lockPath, 'utf8');
  if (raw === null && !(await exists(lockPath))) return { present: false };
  const checks = [], check = (name, ok, detail) => { checks.push({ name, ok, detail }); return ok; };
  let lock = null;
  try { lock = JSON.parse(raw); } catch {}
  if (!check('lock-readable', !!lock && typeof lock === 'object', lock ? 'parsed' : 'the lock is not JSON')) return { present: true, ok: false, lock, checks };
  const job = await lockJob(lock);
  if (!check('job-known', !!job?.nonce, job ? (job.nonce ? `nonce ${job.nonce}` : 'no nonce for the job') : 'the lock names no job')) return { present: true, ok: false, lock, checks };
  const done = await readText(job.donePath, 'ascii');
  check('marker-complete', done === job.nonce, done === null ? `${job.donePath} is missing` : done === job.nonce ? 'matches the nonce' : `holds ${JSON.stringify(done.slice(0, 40))}`);
  const resultBytes = await readText(job.resultPath);
  const result = resultBytes ? Buffer.from(resultBytes).toString('utf16le').replace(/^﻿/, '') : '';
  const status = /^status=(ok|error)\r?$/m.exec(result)?.[1] ?? null;
  check('result-complete', result.startsWith(`nonce=${job.nonce}`) && !!status, status ? `status=${status}` : 'no complete result');
  const running = await processRunning();
  check('no-ichitaro-process', !running, running ? 'an Ichitaro process is running' : 'none running');
  for (const file of job.files.filter(Boolean)) {
    const first = await readText(file);
    if (first === null) { check(`stable:${path.basename(file)}`, !(job.required && status === 'ok'), status === 'ok' && job.required ? `${file} is missing although the macro reported ok` : `${file} was not written (status=${status})`); continue; }
    await pause(stableMs);
    const second = await readText(file);
    const valid = !job.required || first.subarray(0, 5).toString('latin1') === '%PDF-';
    check(`stable:${path.basename(file)}`, valid && second !== null && sha256(first) === sha256(second), `${sha256(first).slice(0, 16)} over ${stableMs}ms${valid ? '' : ', not a PDF'}`);
  }
  return { present: true, ok: checks.every(item => item.ok), lock, checks };
}

/** Release a lock that passes every check. The lock content is returned for the record. */
export async function releaseStaleLock(lockPath, options = {}) {
  const result = await checkStaleLock(lockPath, options);
  if (!result.present || !result.ok) return { ...result, released: false };
  await fs.unlink(lockPath);
  return { ...result, released: true, releasedAt: new Date().toISOString() };
}

// What heartbeat.json says about the lock: present or not, since when, for which
// catalog and why. The catalog id comes from the lock's context (0.17.1) or from
// a path under the executor's work root (<work-root>/<catalog-id>[-n]/...).
export async function lockState(lockPath, { workRoot = null } = {}) {
  const raw = await readText(lockPath, 'utf8');
  if (raw === null) return (await exists(lockPath)) ? { present: true, reason: 'the lock cannot be read' } : { present: false };
  let lock = {};
  try { lock = JSON.parse(raw); } catch {}
  const file = lock.pdf ?? lock.output ?? lock.sampleDir ?? null;
  let catalogId = lock.context?.catalogId ?? null;
  if (!catalogId && file && workRoot) {
    const relative = path.relative(path.resolve(workRoot), path.resolve(file));
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) catalogId = relative.split(path.sep)[0].replace(/-\d+$/, '');
  }
  // A lock before 0.17.1 has no context: the document is named by its PDF (or sample folder).
  const documentId = lock.context?.documentId ?? (lock.pdf ? path.basename(lock.pdf).replace(/.pdf$/i, '') : lock.sampleDir ? path.basename(lock.sampleDir) : null);
  return { present: true, createdAt: lock.createdAt ?? null, catalogId, documentId, pid: lock.pid ?? null, uncertain: lock.uncertain === true,
    reason: lock.reason ?? (lock.uncertain ? 'unknown outcome' : 'held by a running macro (or left by a process that ended without a recorded reason)') };
}
