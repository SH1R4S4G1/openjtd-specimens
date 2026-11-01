// PDF Catalog v1 (CR-006): existing JTD documents that this application did not
// make are opened in Ichitaro one at a time and saved as PDF with the same
// SaveDocument call as --pdf. Each JTD is copied into the output directory and
// only the copy is opened; its hash must equal the catalog's before opening and
// after closing. A document that cannot be opened or saved is recorded and the
// batch goes on; an unknown outcome (timeout) or any unexpected error stops it.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assertSupportedSchema, assertJsonData, validateSchema } from './schema-validation.mjs';
import { CFB_SIGNATURE } from './cfb.mjs';
import { APPLICATION_VERSION } from './sample-schema.mjs';
import { pdfPageCount } from './pdf-pages.mjs';
import { failedSheetPdfs, sheetPdfRecords } from './adapters/macro.mjs';
import { readFileRetry, isSharingViolation } from './file-retry.mjs';

// What Ichitaro was seen to open without a dialog (2026-10-17): an OLE compound
// file (JTD, and the Ver7, template and compressed saves) or the older Ichitaro
// format starting with "DOC" and five NUL bytes (Ver5 and Ver6 saves). A file
// with other bytes made Ichitaro show a modal dialog ("ファイル形式が拡張子と一致
// していないため読み込めません。"), which would stop the batch as a timeout.
export const ICHITARO_SIGNATURES = Object.freeze([CFB_SIGNATURE, Buffer.from('444f430000000000', 'hex')]);

export const PDF_CATALOG_KIND = 'pdf-from-jtd';
export const PDF_CATALOG_SCHEMA_PATH = 'schemas/pdf-catalog.schema.json';
export const PDF_CATALOG_SCHEMA = JSON.parse(readFileSync(new URL(`../${PDF_CATALOG_SCHEMA_PATH}`, import.meta.url), 'utf8'));
assertSupportedSchema(PDF_CATALOG_SCHEMA);

// The public capability, listed in capabilities.json beside the Sample Catalog ones.
export const PDF_CATALOG_CAPABILITY = Object.freeze({
  id: PDF_CATALOG_KIND,
  description: '既存のJTD（このアプリが作っていない文書）を開いてPDFに保存する（PDF Catalog、1カタログ1000件まで）',
  parametersSchema: PDF_CATALOG_SCHEMA_PATH,
  catalog: 'PDF Catalog v1',
  limitations: [
    'Separate catalog kind (kind: pdf-from-jtd), not a Sample Catalog document; no baseline is made and nothing in the document is read back or verified. Up to 1000 documents, processed one at a time.',
    'Each JTD is copied from the input directory into the output directory, and only the copy is opened. A copy whose SHA-256 differs from the catalog is INPUT_MISMATCH; a file that starts neither with the OLE compound file signature (JTD, Ver7, template, compressed) nor with the older Ichitaro signature "DOC" and five NUL bytes (Ver5, Ver6) is NOT_ICHITARO_FORMAT, because other bytes made Ichitaro show a modal dialog. Ichitaro is not started for either.',
    'One macro run per document: WarningMode(0), OpenDocumentFile, SaveDocument(<pdf>,"","",23) as in --pdf, then GetSheetCount() and CountMacros(2) are recorded, the document is closed without saving (Close(3)) and Ichitaro quits (Quit(3)). The copy\'s SHA-256 is compared before opening and after closing (JTD_CHANGED when different).',
    'A macro that reports an error while opening, saving the PDF or closing (OPEN_FAILED, PDF_FAILED, CLOSE_FAILED; reasonCode MACRO_ERROR) is recorded and the batch continues. The outcome is unknown in two cases only, and the batch then stops with the adapter lock left (with its reason) for a person to look at: no completion marker in time (a dialog, for example: TIMEOUT_UNKNOWN_OUTCOME, the text of the Ichitaro windows is recorded by UI Automation without clicking), or an Ichitaro process still running after the marker (ICHITARO_STILL_RUNNING). Sharing violations (EBUSY, EPERM, EACCES) on any file are retried up to a limit (since 0.17.1); a file still held after that is FILE_BUSY (reasonCode NOT_VERIFIED) and the batch continues.',
    'A stopped catalog can be resumed (since 0.17.1): documents with an outcome from an earlier attempt are carried over unchanged, and only the stopped document and those not reached are run again.',
    'The default PDF (document.pdf) holds one sheet: the sheet that was current when the JTD was last saved, not necessarily the main sheet. Since 0.17.0 a document with two or more sheets (GetSheetCount) also gets one PDF per sheet (sheet-<i>.pdf, i counted from the left), saved in the same macro run after the default PDF by ChangeCurrentSheet(i) and the same SaveDocument call; the sheet kind (1 main, 2 Ichitaro sheet, 10 OLE sheet), tab caption and count of text characters (GetString(1) after SelectAll(1); figures and images are not counted, null when it could not be read) are recorded. Since 0.17.2 every sheet is tried even when an earlier one fails; a sheet without a PDF has path null, a reason (EMPTY_SHEET_NOT_SAVED, SAVE_FAILED, SHEET_FAILED, PDF_NOT_WRITTEN, NOT_REACHED) and the message. A save that fails on a sheet with no text characters (EMPTY_SHEET_NOT_SAVED) leaves the document PDF_SAVED; any other sheet without a PDF makes it SHEET_PDF_FAILED (reasonCode MACRO_ERROR, the batch continues), keeping document.pdf and every sheet PDF that was written. OLE sheets were not tried on the real machine.',
    'The PDF page count is counted from the uncompressed page objects; font substitution and the rendered appearance are not verified.',
  ],
});

// outcome (fine reason) -> reasonCode (the vocabulary shared with Sample Catalog
// results and bundle.json counts). Only the stopping outcomes end the batch.
export const PDF_OUTCOMES = Object.freeze({
  PDF_SAVED: 'VERIFIED',
  INPUT_MISMATCH: 'NOT_VERIFIED',
  NOT_ICHITARO_FORMAT: 'NOT_VERIFIED',
  OPEN_FAILED: 'MACRO_ERROR',
  PDF_FAILED: 'MACRO_ERROR',
  CLOSE_FAILED: 'MACRO_ERROR',
  SHEET_PDF_FAILED: 'MACRO_ERROR',
  JTD_CHANGED: 'NOT_VERIFIED',
  FILE_BUSY: 'NOT_VERIFIED',
  TIMEOUT_UNKNOWN_OUTCOME: 'TIMEOUT_UNKNOWN_OUTCOME',
  ICHITARO_STILL_RUNNING: 'TIMEOUT_UNKNOWN_OUTCOME',
  EXECUTION_ERROR: 'EXECUTION_ERROR',
});
// The two unknown outcomes, and an unexpected error. A resumed run runs these documents again.
export const STOPPING_OUTCOMES = new Set(['TIMEOUT_UNKNOWN_OUTCOME', 'ICHITARO_STILL_RUNNING', 'EXECUTION_ERROR']);
// MacroAdapter.exportPdf arguments, for the parameter exposure audit.
export const PDF_EXPORT_FIELDS = Object.freeze(['jtd', 'pdf', 'workDir', 'existing', 'sheetPdfPrefix']);

const fail = (location, message) => { throw Object.assign(new Error(`${location}: ${message}`), { code: 'ERR_SAMPLE_SEMANTIC', path: location }); };
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';

export const isPdfCatalog = input => input !== null && typeof input === 'object' && !Array.isArray(input) && input.kind === PDF_CATALOG_KIND;

export function validatePdfCatalog(input) {
  assertJsonData(input);
  validateSchema(input, PDF_CATALOG_SCHEMA);
  if (reserved.test(input.id)) fail('catalog.id', 'reserved catalog id');
  const ids = new Set(), files = new Set();
  for (const [i, document] of input.documents.entries()) {
    if (reserved.test(document.id) || ids.has(document.id)) fail(`documents[${i}]`, `duplicate or reserved document id ${document.id}`);
    if (files.has(document.file.toLowerCase())) fail(`documents[${i}]`, `duplicate file ${document.file} (case is ignored)`);
    ids.add(document.id); files.add(document.file.toLowerCase());
  }
  return { ok: true, schemaVersion: input.schemaVersion, kind: input.kind, catalogId: input.id, documentCount: input.documents.length, capabilities: [PDF_CATALOG_KIND] };
}

// Macro files are evidence only: one still held after the retry limit is left out.
async function fileRecord(kind, file) {
  try { const bytes = await readFileRetry(file); return { kind, path: file, sha256: sha256(bytes), bytes: bytes.length }; }
  catch (error) { if (error.code === 'ENOENT' || isSharingViolation(error)) return null; throw error; }
}

// Turn one exportPdf outcome into the recorded fields. A failing getter after the
// PDF was saved (phase inspect) keeps the PDF; a sheet or close failure keeps a
// valid PDF and the sheet PDFs already written.
async function pdfOutcome(error, pdfPath, sheetPdfPrefix) {
  const phase = error.details?.errorPhase ?? null;
  const base = { jtdSha256AfterClose: error.jtdSha256AfterClose ?? null, macroMs: error.durationMs ?? null, error: { code: error.code ?? null, phase, message: error.message } };
  if (error.code === 'ERR_MACRO_TIMEOUT') return { outcome: 'TIMEOUT_UNKNOWN_OUTCOME', ...base };
  if (error.code === 'ERR_ICHITARO_STILL_RUNNING') return { outcome: 'ICHITARO_STILL_RUNNING', ...base };
  // The macro finished and Ichitaro quit, but a file stayed held past the retry limit.
  if (isSharingViolation(error)) return { outcome: 'FILE_BUSY', ...base };
  if (error.code === 'ERR_PDF_JTD_CHANGED') return { outcome: 'JTD_CHANGED', pdf: error.pdf, sheetPdfs: error.pdf?.sheetPdfs ?? [], ...base };
  if (error.code === 'ERR_PDF_NOT_WRITTEN') return { outcome: 'PDF_FAILED', ...base };
  if (error.code !== 'ERR_MACRO_EXECUTION') return { outcome: 'EXECUTION_ERROR', ...base };
  let pdf = null;
  const sheet = typeof phase === 'string' && phase.startsWith('sheet ');
  const counts = Object.fromEntries(['sheets', 'documentMacros'].map(key => [key, /^\d+$/.test(error.details?.[key] ?? '') ? Number(error.details[key]) : null]));
  const sheetPdfs = sheetPdfPrefix && error.details ? await sheetPdfRecords(error.details, sheetPdfPrefix) : [];
  if (phase === 'inspect' || phase === 'close' || sheet) {
    let bytes = null;
    try { bytes = await readFileRetry(pdfPath); } catch (readError) { if (readError.code !== 'ENOENT' && !isSharingViolation(readError)) throw readError; }
    if (bytes?.length && bytes.subarray(0, 5).toString('latin1') === '%PDF-') pdf = { path: pdfPath, bytes: bytes.length, sha256: sha256(bytes), ...pdfPageCount(bytes) };
  }
  if (phase === 'inspect' && pdf) return { outcome: error.jtdSha256AfterClose === error.jtdSha256 ? 'PDF_SAVED' : 'JTD_CHANGED', pdf, sheetPdfs, ...counts, ...base };
  return { outcome: phase === 'open' ? 'OPEN_FAILED' : phase === 'close' ? 'CLOSE_FAILED' : sheet ? 'SHEET_PDF_FAILED' : 'PDF_FAILED', pdf, sheetPdfs, ...counts, ...base };
}

// Documents of an earlier attempt that keep their result when a stopped catalog is
// resumed: every one with an outcome other than a stop. Their records (paths and
// hashes) are carried over as they are; the caller makes the paths readable.
export function carriedDocuments(catalog, previous) {
  if (!previous) return new Map();
  if (previous.kind !== PDF_CATALOG_KIND || previous.catalogId !== catalog.id) throw Object.assign(new Error(`The results to resume are for ${previous.kind} ${previous.catalogId}, not this PDF Catalog ${catalog.id}.`), { code: 'ERR_RESUME_MISMATCH' });
  const ids = new Set(catalog.documents.map(document => document.id));
  return new Map(previous.results.filter(result => ids.has(result.documentId) && result.outcome && !STOPPING_OUTCOMES.has(result.outcome)).map(result => [result.documentId, result]));
}

/**
 * Run a validated PDF Catalog. inputDirectory holds the catalog's inputs/ files;
 * outputDirectory must not exist. Writes request.json, compilation.json, jtd/
 * (the copies), pdf/ and execution-results.json, and returns the results.
 * resume: the execution-results.json of the stopped attempt; its documents with an
 * outcome are carried over and only the others are run (0.17.1).
 */
export async function runPdfCatalog(catalog, inputDirectory, outputDirectory, { adapter, ichitaro = null, windows = () => null, log = () => {}, now = Date.now, resume = null } = {}) {
  validatePdfCatalog(catalog);
  const carried = carriedDocuments(catalog, resume);
  const attempt = resume ? (resume.resumed?.attempt ?? 1) + 1 : 1;
  const destination = path.resolve(outputDirectory), inputs = path.resolve(inputDirectory);
  await fs.mkdir(destination); // exclusive: never overwrite earlier work
  const requestBytes = json(catalog);
  await fs.writeFile(path.join(destination, 'request.json'), requestBytes, { flag: 'wx' });
  const compilation = { schemaVersion: 1, kind: PDF_CATALOG_KIND, applicationVersion: APPLICATION_VERSION, catalogId: catalog.id, requestFile: 'request.json', requestSha256: sha256(requestBytes),
    inputDirectory: inputs, documents: catalog.documents.map(({ id, file, sha256: hash }) => ({ documentId: id, file, sha256: hash, copy: `jtd/${id}.jtd` })) };
  await fs.writeFile(path.join(destination, 'compilation.json'), json(compilation), { flag: 'wx' });
  await fs.mkdir(path.join(destination, 'jtd')); await fs.mkdir(path.join(destination, 'pdf'));
  const results = [];
  let stopped = null;
  for (const document of catalog.documents) {
    if (carried.has(document.id)) {
      const previous = carried.get(document.id);
      results.push({ ...previous, carriedOver: { fromAttempt: previous.carriedOver?.fromAttempt ?? attempt - 1 } });
      log({ event: 'document-carried', documentId: document.id, outcome: previous.outcome });
      continue;
    }
    const started = now();
    log({ event: 'document-start', documentId: document.id });
    const copy = path.join(destination, 'jtd', `${document.id}.jtd`), pdfPath = path.join(destination, 'pdf', `${document.id}.pdf`), workDir = path.join(destination, 'pdf', `${document.id}.macro`);
    const record = { documentId: document.id, file: document.file, reasonCode: null, outcome: null,
      jtd: { submittedSha256: document.sha256, bytes: null, sha256BeforeOpen: null, sha256AfterClose: null, unchanged: null }, pdf: null, sheetPdfs: [], sheets: null, documentMacros: null, durationMs: null, macroMs: null };
    const sheetPdfPrefix = path.join(destination, 'pdf', `${document.id}.sheet-`);
    const sheetRecord = ({ sheet, kind, caption, path: file, sha256: hash, bytes, pages, characters = null, charactersError, reason = null, message = null }) =>
      ({ sheet, kind, caption, path: file, characters, ...(charactersError !== undefined ? { charactersError } : {}), ...(file ? { sha256: hash, bytes, pages: pages ?? null } : { reason, message }) });
    try {
      let bytes = null;
      let busy = null;
      try { bytes = await readFileRetry(path.join(inputs, ...document.file.split('/'))); }
      catch (error) { if (isSharingViolation(error)) busy = error; else if (error.code !== 'ENOENT') throw error; }
      if (busy) Object.assign(record, { outcome: 'FILE_BUSY', error: { code: busy.code, phase: 'copy', message: `${document.file} stayed held by another process for ${busy.retriedMs}ms: ${busy.message}` } });
      else if (!bytes) Object.assign(record, { outcome: 'INPUT_MISMATCH', error: { code: 'ENOENT', phase: 'copy', message: `${document.file} is missing in the input directory.` } });
      else {
        record.jtd.bytes = bytes.length;
        record.jtd.sha256BeforeOpen = sha256(bytes);
        if (record.jtd.sha256BeforeOpen !== document.sha256) Object.assign(record, { outcome: 'INPUT_MISMATCH', error: { code: 'HASH_MISMATCH', phase: 'copy', message: `${document.file} has SHA-256 ${record.jtd.sha256BeforeOpen}, not the catalog's.` } });
        else if (!ICHITARO_SIGNATURES.some(signature => bytes.subarray(0, 8).equals(signature))) Object.assign(record, { outcome: 'NOT_ICHITARO_FORMAT', error: { code: 'NOT_ICHITARO_FORMAT', phase: 'copy', message: `${document.file} starts with ${bytes.subarray(0, 8).toString('hex')}, neither an OLE compound file nor the older Ichitaro format; Ichitaro was not started.` } });
      }
      if (!record.outcome) {
        await fs.writeFile(copy, bytes, { flag: 'wx' });
        try {
          const pdf = await adapter.exportPdf({ jtd: copy, pdf: pdfPath, workDir, existing: true, sheetPdfPrefix, context: { catalogId: catalog.id, documentId: document.id } });
          const { macro, sheets = null, documentMacros = null, durationMs, jtdSha256AfterClose, sheetPdfs = [], exitWaitMs = null, ...kept } = pdf;
          Object.assign(record, { outcome: 'PDF_SAVED', pdf: { path: kept.path, sha256: kept.sha256, bytes: kept.bytes, pages: kept.pages ?? null, pagesMethod: kept.pagesMethod ?? null }, sheetPdfs: sheetPdfs.map(sheetRecord), sheets, documentMacros, macroMs: durationMs ?? null, exitWaitMs });
          // The macro tried every sheet (0.17.2); a sheet without a PDF, other than an empty one, fails the document.
          const failed = failedSheetPdfs(sheetPdfs);
          if (failed.length) Object.assign(record, { outcome: 'SHEET_PDF_FAILED', error: { code: 'ERR_SHEET_PDF_NOT_SAVED', phase: `sheet ${failed[0].sheet}`, message: failed.map(item => `sheet ${item.sheet} ${item.reason}: ${item.message}`).join('; ') } });
          record.jtd.sha256AfterClose = jtdSha256AfterClose ?? null;
        } catch (error) {
          const result = await pdfOutcome(error, pdfPath, sheetPdfPrefix);
          const { jtdSha256AfterClose, pdf, sheetPdfs = [], sheets = null, documentMacros = null, ...rest } = result;
          Object.assign(record, rest, { sheetPdfs: sheetPdfs.map(sheetRecord), sheets, documentMacros });
          if (pdf) record.pdf = { path: pdf.path, sha256: pdf.sha256, bytes: pdf.bytes, pages: pdf.pages ?? null, pagesMethod: pdf.pagesMethod ?? null };
          if (pdf?.sheets !== undefined) Object.assign(record, { sheets: pdf.sheets, documentMacros: pdf.documentMacros });
          record.jtd.sha256AfterClose = jtdSha256AfterClose ?? null;
          if (result.outcome === 'TIMEOUT_UNKNOWN_OUTCOME' || result.outcome === 'ICHITARO_STILL_RUNNING') record.windows = windows();
        }
        record.macro = (await Promise.all([fileRecord('macro-source', path.join(workDir, 'runner.txt')), fileRecord('macro-result', path.join(workDir, 'result.txt'))])).filter(Boolean);
        if (record.jtd.sha256AfterClose) record.jtd.unchanged = record.jtd.sha256AfterClose === record.jtd.sha256BeforeOpen;
      }
    } catch (error) {
      Object.assign(record, { outcome: 'EXECUTION_ERROR', error: { code: error.code ?? null, phase: null, message: error.message } });
    }
    record.reasonCode = PDF_OUTCOMES[record.outcome];
    record.durationMs = now() - started;
    results.push(record);
    log({ event: 'document-completed', documentId: document.id, outcome: record.outcome, reasonCode: record.reasonCode, durationMs: record.durationMs });
    if (STOPPING_OUTCOMES.has(record.outcome)) { stopped = { documentId: document.id, outcome: record.outcome, message: record.error?.message ?? record.outcome }; break; }
  }
  const tally = key => Object.fromEntries([...new Set(results.map(result => result[key]))].map(code => [code, results.filter(result => result[key] === code).length]));
  const summary = {
    schemaVersion: 2, kind: PDF_CATALOG_KIND,
    ok: !stopped && results.length === catalog.documents.length && results.every(result => result.outcome === 'PDF_SAVED'),
    catalogId: catalog.id, compileDirectory: destination, jobCount: catalog.documents.length,
    application: { version: APPLICATION_VERSION }, ichitaro,
    counts: tally('reasonCode'), outcomeCounts: tally('outcome'), stopped,
    ...(resume ? { resumed: { attempt, carriedOver: carried.size, previousStopped: resume.stopped ?? null } } : {}),
    method: 'Each JTD copy opened in a separate macro run with WarningMode(0); SaveDocument format 23 (PDF) as in --pdf; with two or more sheets, also each sheet after ChangeCurrentSheet(i) with the same call, every sheet tried in its own try; closed without saving; SHA-256 of the copy compared before opening and after closing',
    results,
  };
  await fs.writeFile(path.join(destination, 'execution-results.json'), json(summary), { flag: 'wx' });
  return summary;
}
