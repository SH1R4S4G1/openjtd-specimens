#!/usr/bin/env node
// Export the results of bin/ichitaro-request.mjs (or of bin/ichitaro-pdf.mjs for
// a PDF Catalog, CR-006) as a hand-over directory in
// experiment storage (for example output/<name>), with package-manifest.json.
// Hashes are taken from the existing evidence (run manifests verified by
// verifyRun, and the PDF records in execution-results.json); copies are only
// checked against them, never treated as a new source of truth. No zip is made.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyRun } from '../src/evidence.mjs';

const [compileDirectory, packageDirectory, ...extra] = process.argv.slice(2);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  if (!compileDirectory || !packageDirectory || extra.length) throw new Error('Usage: node bin/ichitaro-package.mjs <compile-directory> <new-package-directory>');
  const source = path.resolve(compileDirectory), target = path.resolve(packageDirectory);
  const results = JSON.parse(await fs.readFile(path.join(source, 'execution-results.json'), 'utf8'));
  const compilation = JSON.parse(await fs.readFile(path.join(source, 'compilation.json'), 'utf8'));
  await fs.mkdir(target); // exclusive: never overwrite an earlier package
  const files = [];
  // Copy a file whose hash is already recorded; refuse if the bytes differ.
  async function include(from, to, recorded, recordedBy) {
    const bytes = await fs.readFile(from);
    if (recorded && (sha256(bytes) !== recorded.sha256 || bytes.length !== recorded.bytes)) throw new Error(`Recorded hash does not match ${from}`);
    await fs.mkdir(path.dirname(path.join(target, to)), { recursive: true });
    await fs.writeFile(path.join(target, to), bytes, { flag: 'wx' });
    files.push({ path: to, bytes: bytes.length, sha256: recorded?.sha256 ?? sha256(bytes), recordedBy });
  }
  // Request-level files are hashed in compilation.json; results are copied as written.
  await include(path.join(source, 'request.json'), 'request.json', { sha256: compilation.requestSha256, bytes: (await fs.stat(path.join(source, 'request.json'))).size }, 'compilation.json requestSha256');
  await include(path.join(source, 'compilation.json'), 'compilation.json', null, 'package export');
  await include(path.join(source, 'execution-results.json'), 'execution-results.json', null, 'package export');
  const runs = [];
  // PDF Catalog (CR-006): no runs. Each document's PDF and macro files, with the
  // hashes of the submitted JTD and of its copy after closing; the JTD itself is
  // not handed back (the lab has it).
  if (results.kind === 'pdf-from-jtd') {
    const documents = [];
    for (const result of results.results) {
      const dir = `documents/${result.documentId}`;
      if (result.pdf?.sha256) await include(result.pdf.path, `${dir}/document.pdf`, result.pdf, 'execution-results.json pdf');
      // 0.17.0: one PDF per sheet for a document with two or more sheets.
      for (const sheet of (result.sheetPdfs ?? []).filter(item => item.sha256)) await include(sheet.path, `${dir}/sheet-${sheet.sheet}.pdf`, sheet, 'execution-results.json sheetPdfs');
      for (const macro of result.macro ?? []) await include(macro.path, `${dir}/${macro.kind}.txt`, macro, 'execution-results.json macro');
      documents.push({ documentId: result.documentId, reasonCode: result.reasonCode, outcome: result.outcome,
        jtd: { file: result.file, sha256: result.jtd.submittedSha256, bytes: result.jtd.bytes, sha256AfterClose: result.jtd.sha256AfterClose, unchanged: result.jtd.unchanged },
        pdf: result.pdf?.sha256 ? { path: `${dir}/document.pdf`, sha256: result.pdf.sha256, bytes: result.pdf.bytes, pages: result.pdf.pages } : null,
        sheets: result.sheets ?? null,
        // 0.17.2: the text character count of each sheet, and why a sheet has no PDF (results of 0.17.1 and earlier have neither).
        sheetPdfs: (result.sheetPdfs ?? []).map(({ sheet, kind, caption, sha256, bytes, pages, characters, charactersError, reason, message }) => ({ sheet, kind, caption, path: sha256 ? `${dir}/sheet-${sheet}.pdf` : null,
          characters: characters ?? null, ...(charactersError !== undefined ? { charactersError } : {}), ...(sha256 ? { sha256, bytes, pages } : reason ? { reason, message } : {}) })) });
    }
    const manifest = { schemaVersion: 1, kind: results.kind, createdAt: new Date().toISOString(), catalogId: results.catalogId, requestSha256: compilation.requestSha256,
      application: results.application, ichitaro: results.ichitaro, runs, documents, files };
    await fs.writeFile(path.join(target, 'package-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify({ ok: true, packageDirectory: target, files: files.length, documents: documents.length }, null, 2) + '\n');
  } else {
    for (const result of results.results.filter(item => item.runDir)) {
      const integrity = await verifyRun(result.runDir);
      runs.push({ sampleId: result.sampleId, runId: path.basename(result.runDir), reasonCode: result.reasonCode, verifyRun: { ok: integrity.ok, integrityOk: integrity.integrityOk, complete: integrity.complete } });
      if (!integrity.integrityOk) throw new Error(`Run integrity failed for ${result.runDir}; nothing is exported from a damaged run.`);
      if (result.document) await include(result.document.path, `samples/${result.sampleId}/document.jtd`, result.document, 'run manifest (verifyRun)');
      if (result.manifest) await include(result.manifest.path, `samples/${result.sampleId}/manifest.json`, result.manifest, 'run index (verifyRun)');
      if (result.baseline?.document) await include(result.baseline.document.path, `samples/${result.sampleId}/baseline.jtd`, result.baseline.document, 'run manifest (verifyRun)');
      if (result.control?.document) await include(result.control.document.path, `samples/${result.sampleId}/control.jtd`, result.control.document, 'run manifest (verifyRun)');
      for (const macro of result.macro ?? []) await include(macro.path, `samples/${result.sampleId}/${macro.kind}.txt`, macro, 'run manifest evidence (verifyRun)');
      if (result.pdf?.sha256) await include(result.pdf.path, `samples/${result.sampleId}/document.pdf`, result.pdf, 'execution-results.json pdf');
    }
    const manifest = { schemaVersion: 1, createdAt: new Date().toISOString(), catalogId: results.catalogId, requestSha256: compilation.requestSha256,
      application: results.application, ichitaro: results.ichitaro, runs, files };
    await fs.writeFile(path.join(target, 'package-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify({ ok: true, packageDirectory: target, files: files.length, runs: runs.length }, null, 2) + '\n');
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ ok: false, error: error.message }) + '\n');
  process.exitCode = 1;
}
