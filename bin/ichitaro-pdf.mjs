#!/usr/bin/env node
// Save existing JTD documents as PDF (PDF Catalog v1, CR-006), one at a time.
//
//   node bin/ichitaro-pdf.mjs <pdf-catalog.json> <input-directory> <new-output-directory> [--resume <execution-results.json>] [--exe <taro36.exe>] [--allow-running-ichitaro]
//
// <input-directory> holds the catalog's inputs/<name>.jtd files. The JTDs are copied into the output directory and only the
// copies are opened. A document that cannot be opened or saved is recorded and the
// batch continues; a timeout (unknown outcome) or an unexpected error stops it.
// The results are execution-results.json in the output directory; hand them over
// with node bin/ichitaro-package.mjs <output-directory> <new-package-directory>.
// --resume takes the execution-results.json of a stopped attempt of the same
// catalog: its documents with an outcome are carried over (their paths must be
// readable), and only the stopped document and the ones not reached are run.
// The Ichitaro that runs is --exe, then ICHITARO_EXE, then the default (src/adapters/macro.mjs);
// its existence is checked before the output directory is made. An Ichitaro already running
// stops the first document (ERR_ICHITARO_ALREADY_RUNNING) unless --allow-running-ichitaro /
// ICHITARO_ALLOW_RUNNING=1.
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { loadCatalog } from '../src/sample-catalog.mjs';
import { MacroAdapter } from '../src/adapters/macro.mjs';
import { takeIchitaroOptions, ICHITARO_OPTIONS_USAGE } from '../src/ichitaro-options.mjs';
import { runPdfCatalog } from '../src/pdf-catalog.mjs';
import { ichitaroBuild, ichitaroWindows } from '../src/ichitaro-build.mjs';

const log = event => process.stderr.write(JSON.stringify(event) + '\n');
try {
  const usage = () => Object.assign(new Error(`Usage: node bin/ichitaro-pdf.mjs <pdf-catalog.json> <input-directory> <new-output-directory> [--resume <execution-results.json>] ${ICHITARO_OPTIONS_USAGE}`), { code: 'ERR_CLI_USAGE' });
  let options;
  try { options = takeIchitaroOptions(process.argv.slice(2)); } catch { throw usage(); }
  const { args } = options;
  const resumeAt = args.indexOf('--resume');
  const resumePath = resumeAt >= 0 ? args.splice(resumeAt, 2)[1] : null;
  if (args.length !== 3 || args.some(arg => arg.startsWith('--')) || (resumeAt >= 0 && !resumePath)) throw usage();
  const resume = resumePath ? JSON.parse((await fs.readFile(path.resolve(resumePath), 'utf8')).replace(/^﻿/, '')) : null;
  const [catalogPath, inputDirectory, outputDirectory] = args;
  const catalog = await loadCatalog(path.resolve(catalogPath));
  const adapter = new MacroAdapter({ exe: options.exe, allowRunning: options.allowRunning });
  await adapter.connect(); // a missing executable stops here, before the output directory is made
  const summary = await runPdfCatalog(catalog, inputDirectory, outputDirectory, { adapter, ichitaro: await ichitaroBuild(adapter.exe), windows: () => ichitaroWindows(adapter.exe), log, resume });
  process.stdout.write(JSON.stringify({ ok: summary.ok, compileDirectory: summary.compileDirectory, counts: summary.counts, outcomeCounts: summary.outcomeCounts, stopped: summary.stopped, resumed: summary.resumed ?? null,
    documents: summary.results.map(({ documentId, outcome, reasonCode, pdf, error }) => ({ documentId, outcome, reasonCode, pdf: pdf?.sha256 ?? null, ...(error ? { error: error.message } : {}) })) }, null, 2) + '\n');
  if (!summary.ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: { code: error.code ?? null, message: error.message } }, null, 2) + '\n');
  process.exitCode = error.code === 'ERR_CLI_USAGE' ? 2 : 1;
}
