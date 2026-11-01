#!/usr/bin/env node
// Compile a Sample Catalog and run every job with the macro adapter, one at a
// time. Each run is re-verified (hashes and completion) and the results are
// collected next to compilation.json.
//
// Continuation policy: a job whose macro completed but whose readback did not
// match is recorded (status "saved", reasonCode READBACK_MISMATCH) and the batch
// continues. Anything with an unknown or abnormal outcome stops the batch: a
// timeout, a macro error (Ichitaro may still be open), a failed run integrity
// check, or any other exception. Integrity, completion and acceptance stay
// separate in the recorded verifyRun result.
//
//   node bin/ichitaro-request.mjs <sample-catalog.json> <new-compile-directory> [output-root] [--pdf] [--exe <taro36.exe>] [--allow-running-ichitaro]
//
// The Ichitaro that runs is --exe, then ICHITARO_EXE, then the default (src/adapters/macro.mjs);
// its existence is checked before anything is compiled. An Ichitaro already running stops the
// first job (ERR_ICHITARO_ALREADY_RUNNING) unless --allow-running-ichitaro / ICHITARO_ALLOW_RUNNING=1.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { loadCatalog, writeCompilation } from '../src/sample-catalog.mjs';
import { MacroAdapter } from '../src/adapters/macro.mjs';
import { takeIchitaroOptions, ICHITARO_OPTIONS_USAGE } from '../src/ichitaro-options.mjs';
import { runMacroExperiment } from '../src/macro-run.mjs';
import { verifyRun } from '../src/evidence.mjs';
import { APPLICATION_VERSION } from '../src/sample-schema.mjs';
import { ichitaroBuild } from '../src/ichitaro-build.mjs';

let options = { args: [] };
try { options = takeIchitaroOptions(process.argv.slice(2)); } catch (error) { options.error = error; }
const pdfOption = options.args.includes('--pdf');
const [catalogPath, compileDirectory, outputRoot = 'runs', ...extra] = options.args.filter(arg => arg !== '--pdf');
const log = event => process.stderr.write(JSON.stringify(event) + '\n');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

// Document-level readback recorded for every sample (APP-05), without the
// per-character arrays that the manifest keeps as evidence.
function documentState(observed) {
  if (!observed) return null;
  const { settings, spacingUnit, marginUnit, orientation, priority, features } = observed;
  return { settings, spacingUnit, marginUnit, orientation, priority, features };
}

async function sampleRecord(runDir, sampleId) {
  const index = await readJson(path.join(runDir, 'index.json'));
  const entry = index.samples.find(sample => sample.id === sampleId);
  if (!entry?.manifest) return { status: entry?.status ?? 'not-run' };
  const manifest = await readJson(path.join(runDir, 'samples', sampleId, entry.manifest.path.split('/').at(-1)));
  const phase = name => manifest.evidence.find(item => item.phase === name);
  return {
    status: manifest.status,
    manifest: { path: path.join(runDir, 'samples', sampleId, 'manifest.json'), sha256: entry.manifest.sha256, bytes: entry.manifest.bytes },
    document: manifest.document ? { path: path.join(runDir, 'samples', sampleId, manifest.document.path), sha256: manifest.document.sha256, bytes: manifest.document.bytes } : null,
    requested: manifest.requested,
    observed: { beforeSave: documentState(phase('before-save')?.observed), reopened: documentState(phase('reopened')?.observed) },
    differences: manifest.verification?.differences ?? [],
    // How the body was compared (for example exact-text or the CR-003 long-text walk),
    // so that a consumer of this file can tell the verification depth per sample.
    bodyComparison: manifest.verification?.bodyComparison ?? null,
    // Which characters the range readback walked one by one (the whole body up to
    // 2000 characters, only annotated paragraphs beyond), null without annotations.
    rangeCoverage: manifest.verification?.rangeProof?.coverage ?? null,
    proofs: Object.fromEntries(Object.entries(manifest.verification ?? {}).filter(([key]) => key.endsWith('Proof')).map(([key, proof]) => [key, { passed: proof.passed, reopened: proof.reopened }])),
    macro: (phase('reopened') ?? phase('before-save'))?.files.filter(file => file.kind === 'macro-source' || file.kind === 'macro-result').map(file => ({ kind: file.kind, path: path.join(runDir, 'samples', sampleId, file.path), sha256: file.sha256, bytes: file.bytes })) ?? [],
  };
}

function reasonCode(error, record, integrity) {
  // The two unknown outcomes: no completion marker in time, or Ichitaro still running after it.
  if (error?.code === 'ERR_MACRO_TIMEOUT' || error?.code === 'ERR_ICHITARO_STILL_RUNNING') return 'TIMEOUT_UNKNOWN_OUTCOME';
  if (error?.code === 'ERR_MACRO_EXECUTION') return 'MACRO_ERROR';
  if (integrity && !integrity.integrityOk) return 'INTEGRITY_FAILED';
  // A completed macro whose readback or structural proof did not match.
  if ((error?.completed && record.status === 'saved') || (error?.readbackMismatch && record.status === 'failed')) return 'READBACK_MISMATCH';
  if (error) return 'EXECUTION_ERROR';
  return record.status === 'verified' ? 'VERIFIED' : 'NOT_VERIFIED';
}

const results = [];
let compilation, adapter;
try {
  if (options.error) throw options.error;
  if (!catalogPath || !compileDirectory || extra.length) throw Object.assign(new Error(`Usage: node bin/ichitaro-request.mjs <sample-catalog.json> <new-compile-directory> [output-root] [--pdf] ${ICHITARO_OPTIONS_USAGE}`), { code: 'ERR_CLI_USAGE' });
  adapter = new MacroAdapter({ exe: options.exe, allowRunning: options.allowRunning });
  await adapter.connect(); // a missing executable stops here, before anything is compiled
  compilation = await writeCompilation(await loadCatalog(catalogPath), compileDirectory);
  const manifest = await readJson(compilation.manifestPath);
  for (const job of manifest.jobs) {
    log({ event: 'job-start', sampleId: job.sampleId });
    const recipe = await readJson(path.join(compilation.directory, job.recipeFile));
    let run, error;
    try { run = await runMacroExperiment(recipe, { outputRoot, adapter, onProgress: log }); }
    catch (caught) { error = caught; }
    const runDir = run?.runDir ?? error?.runDir ?? null;
    const integrity = runDir ? await verifyRun(runDir) : null;
    const record = runDir ? await sampleRecord(runDir, job.outputSampleId) : { status: 'not-run' };
    const baseline = runDir ? await sampleRecord(runDir, job.baselineSampleId) : { status: 'not-run' };
    const control = runDir && job.controlSampleId ? await sampleRecord(runDir, job.controlSampleId) : null;
    const code = reasonCode(error, record, integrity);
    // Optional PDF beside the results, never inside the run evidence (APP-03).
    let pdf = null;
    if (pdfOption && record.document && (code === 'VERIFIED' || code === 'READBACK_MISMATCH')) {
      await fs.mkdir(path.join(compilation.directory, 'pdf'), { recursive: true });
      try { pdf = await adapter.exportPdf({ jtd: record.document.path, pdf: path.join(compilation.directory, 'pdf', `${job.sampleId}.pdf`), workDir: path.join(compilation.directory, 'pdf', `${job.sampleId}.macro`) }); }
      catch (pdfError) { pdf = { error: { message: pdfError.message, code: pdfError.code ?? null } }; }
    }
    results.push({
      sampleId: job.sampleId, recipeFile: job.recipeFile, recipeSha256: job.recipeSha256, runDir, reasonCode: code,
      ...record,
      ...(pdfOption ? { pdf } : {}),
      ...(job.requestSampleId ? { requestSampleId: job.requestSampleId, repeat: job.repeat } : {}),
      baseline: { status: baseline.status, document: baseline.document ?? null, observed: baseline.observed ?? null },
      ...(control ? { control: { status: control.status, document: control.document ?? null, differences: control.differences ?? [] } } : {}),
      // APP-19: which save produced each artefact.
      saves: { baseline: 'first save of a new document (SaveDocument, format 0)', sample: 'save under a new name after opening the saved baseline JTD (SaveDocument, format 0); the file is then reopened and closed without saving' },
      verifyRun: integrity && { ok: integrity.ok, integrityOk: integrity.integrityOk, complete: integrity.complete, errors: integrity.errors },
      expectedEvaluation: 'not-performed',
      ...(error ? { error: { message: error.message, code: error.code ?? null } } : {}),
    });
    log({ event: 'job-completed', sampleId: job.sampleId, status: record.status, reasonCode: code, runDir });
    // Only a completed readback mismatch of the requested sample may continue.
    if (code !== 'VERIFIED' && code !== 'READBACK_MISMATCH') break;
    if (pdf?.error) break; // an unknown PDF export outcome must be inspected first
    if (code === 'READBACK_MISMATCH' && baseline.status !== 'verified') break;
  }
} catch (error) {
  results.push({ reasonCode: 'EXECUTION_ERROR', error: { message: error.message, code: error.code ?? null } });
}
// With --pdf a sample without its PDF is not ok, even when it is the last one
// (an earlier PDF failure already stops the batch and leaves the count short).
const ok = !!compilation && results.length === compilation.sampleCount && results.every(result => result.status === 'verified' && result.verifyRun?.ok && (!pdfOption || !!result.pdf?.sha256));
const summary = {
  schemaVersion: 2, ok, catalogId: compilation?.catalogId ?? null, compileDirectory: compilation?.directory ?? null, jobCount: compilation?.sampleCount ?? 0,
  application: { version: APPLICATION_VERSION }, ichitaro: adapter ? await ichitaroBuild(adapter.exe) : null,
  counts: Object.fromEntries([...new Set(results.map(result => result.reasonCode))].map(code => [code, results.filter(result => result.reasonCode === code).length])),
  results,
};
if (compilation) await fs.writeFile(path.join(compilation.directory, 'execution-results.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ ok, compileDirectory: summary.compileDirectory, counts: summary.counts, jobs: results.map(({ sampleId, status, reasonCode: code, runDir, error }) => ({ sampleId, status, reasonCode: code, runDir, ...(error ? { error: error.message, errorCode: error.code ?? null } : {}) })) }, null, 2) + '\n');
// A usage error exits with 2, as ichitaro-pdf does; every other failure with 1.
if (!ok) process.exitCode = results.some(result => result.error?.code === 'ERR_CLI_USAGE') ? 2 : 1;
