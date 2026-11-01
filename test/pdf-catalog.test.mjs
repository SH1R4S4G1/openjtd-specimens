import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { MacroAdapter, failedSheetPdfs, sheetPdfRecords } from '../src/adapters/macro.mjs';
import { CFB_SIGNATURE } from '../src/cfb.mjs';
import { PDF_OUTCOMES, runPdfCatalog, validatePdfCatalog } from '../src/pdf-catalog.mjs';
import { pdfPageCount } from '../src/pdf-pages.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const utf16 = value => Buffer.from('﻿' + value, 'utf16le');
// Bytes that start like a JTD (an OLE compound file); the content does not matter to the fakes.
const jtdBytes = name => Buffer.concat([CFB_SIGNATURE, Buffer.from(` fake JTD ${name}`)]);
const fakePdf = (pages = 1) => Buffer.from(`%PDF-1.5\n1 0 obj<</Type/Pages/Kids[]/Count ${pages}>>endobj\n${Array.from({ length: pages }, (_, i) => `${i + 2} 0 obj<</Type/Page/Parent 1 0 R>>endobj\n`).join('')}%%EOF\n`);

async function scratch(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ichitaro-pdf-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
const catalogOf = (documents, id = 'existing-pdf') => ({ schemaVersion: 1, kind: 'pdf-from-jtd', id, documents });
async function inputsOf(dir, names) {
  await fs.mkdir(path.join(dir, 'inputs'), { recursive: true });
  const documents = [];
  for (const name of names) {
    const bytes = jtdBytes(name);
    await fs.writeFile(path.join(dir, 'inputs', `${name}.jtd`), bytes);
    documents.push({ id: `doc-${name}`, file: `inputs/${name}.jtd`, sha256: sha256(bytes) });
  }
  return documents;
}

test('PDF Catalog validation: schema, unique ids and files, 1000 documents, and the CLI validate dispatch', async t => {
  const doc = (id, file = `inputs/${id}.jtd`) => ({ id, file, sha256: 'a'.repeat(64) });
  assert.deepEqual(validatePdfCatalog(catalogOf([doc('a1'), doc('b2')])), { ok: true, schemaVersion: 1, kind: 'pdf-from-jtd', catalogId: 'existing-pdf', documentCount: 2, capabilities: ['pdf-from-jtd'] });
  for (const [documents, pattern] of [
    [[doc('a1'), doc('a1', 'inputs/other.jtd')], /duplicate or reserved document id/],
    [[doc('a1', 'inputs/X.JTD'), doc('b2', 'inputs/x.jtd')], /duplicate file/],
    [[doc('con')], /reserved/],
    [[doc('a1', 'inputs/../a.jtd')], /does not match the required form: inputs\/<name>\.jtd relative to the catalog \(got "inputs\/\.\.\/a\.jtd"\)/],
    [[doc('a1', 'inputs/sub/a.jtd')], /required form/],
    [[doc('a1', 'a1.jtd')], /string length 6 is outside 12\.\.127/],
    [[doc('a1', 'inputs/a1.docx')], /required form/],
    [[{ ...doc('a1'), sha256: 'A'.repeat(64) }], /required form: SHA-256 of the submitted JTD, lowercase hex/],
    [[{ ...doc('a1'), title: 'x' }], /unknown field/],
    [[], /array length 0 is outside 1\.\.1000/],
    [Array.from({ length: 1001 }, (_, i) => doc(`d${i}`)), /array length 1001 is outside 1\.\.1000/],
  ]) assert.throws(() => validatePdfCatalog(catalogOf(documents)), pattern);
  assert.equal(validatePdfCatalog(catalogOf(Array.from({ length: 1000 }, (_, i) => doc(`d${i}`)))).documentCount, 1000);
  assert.throws(() => validatePdfCatalog({ ...catalogOf([doc('a1')]), kind: 'text' }), /must equal/);
  const dir = await scratch(t);
  await fs.writeFile(path.join(dir, 'pdf.json'), JSON.stringify(catalogOf([doc('a1')])));
  const cli = spawnSync(process.execPath, ['bin/ichitaro.mjs', 'validate', path.join(dir, 'pdf.json')], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stdout);
  assert.equal(JSON.parse(cli.stdout).kind, 'pdf-from-jtd');
  const compile = spawnSync(process.execPath, ['bin/ichitaro.mjs', 'compile', path.join(dir, 'pdf.json'), path.join(dir, 'out')], { encoding: 'utf8' });
  assert.notEqual(compile.status, 0);
  assert.match(compile.stdout + compile.stderr, /ichitaro-pdf\.mjs/);
  const usage = spawnSync(process.execPath, ['bin/ichitaro-pdf.mjs', path.join(dir, 'pdf.json')], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
});

test('page count is read from uncompressed page objects and refused for object streams or a disagreeing page tree', () => {
  assert.equal(pdfPageCount(fakePdf(3)).pages, 3);
  assert.equal(pdfPageCount(Buffer.concat([fakePdf(2), Buffer.from('3 0 obj<</Type/ObjStm>>endobj')])).pages, null);
  assert.equal(pdfPageCount(Buffer.from(fakePdf(2).toString('latin1').replace('/Count 2', '/Count 5'))).pages, null);
});

// A launch that plays Ichitaro for exportPdf: it reads the nonce from runner.txt,
// writes the PDF and the UTF-16 result, then the completion marker. With
// sheetPrefix and two or more sheets it writes <prefix><i>.pdf for each sheet,
// stopping the macro at failSheet when given (an error outside the sheet's own try).
// sheetErrors ({<i>: {step, message}}) fails sheet i inside its own try (0.17.2) and
// the loop goes on; characters ({<i>: n | 'error'}) is the text count of sheet i.
function pdfLaunch(pdfPath, { status = 'ok', phase = null, pdf = fakePdf(2), sheets = '1', documentMacros = '0', touch = null, never = false, sheetPrefix = null, failSheet = null, sheetErrors = {}, characters = {} } = {}) {
  const seen = [];
  const launch = async (_exe, macroPath) => {
    const source = await fs.readFile(macroPath, 'ascii');
    seen.push(source);
    if (never) return { pid: 1 };
    const dir = path.dirname(macroPath), nonce = /nonce=([0-9a-f-]{36})/.exec(source)[1];
    if (pdf) await fs.writeFile(pdfPath, pdf);
    if (touch) await fs.appendFile(touch, 'changed');
    const sheetLines = [];
    if (sheetPrefix && Number(sheets) >= 2) for (let i = 1; i <= Number(sheets); i++) {
      const failure = sheetErrors[i];
      if (failure?.step === 'change') { sheetLines.push(`sheet${i}.errorStep=change`, `sheet${i}.error=${failure.message}`); continue; }
      sheetLines.push(`sheet${i}.kind=${i === 1 ? 1 : 2}`, `sheet${i}.caption=Sheet${i}`);
      sheetLines.push(characters[i] === 'error' ? `sheet${i}.charactersError=fake count failure` : `sheet${i}.characters=${characters[i] ?? 10 * i}`);
      if (i === failSheet) { status = 'error'; phase = `sheet ${i}`; break; }
      if (failure) { sheetLines.push(`sheet${i}.errorStep=${failure.step}`, `sheet${i}.error=${failure.message}`); continue; }
      await fs.writeFile(`${sheetPrefix}${i}.pdf`, fakePdf(i));
      sheetLines.push(`sheet${i}.saved=1`);
    }
    const counts = [`sheets=${sheets}`, `documentMacros=${documentMacros}`];
    const lines = [`nonce=${nonce}`, ...(status === 'ok' ? [...counts, ...sheetLines, 'status=ok'] : [...(phase?.startsWith('sheet') ? [...counts, ...sheetLines] : []), 'status=error', `errorPhase=${phase}`, 'errorMessage=fake failure'])];
    await fs.writeFile(path.join(dir, 'result.txt'), utf16(lines.join('\r\n') + '\r\n'));
    await fs.writeFile(path.join(dir, 'done.txt'), nonce);
    return { pid: 1 };
  };
  return { launch, seen };
}

test('exportPdf for an existing JTD turns off warnings, keeps the --pdf SaveDocument call and reports coded outcomes', async t => {
  const dir = await scratch(t), exe = path.join(dir, 'fake.exe'), jtd = path.join(dir, 'a.jtd');
  await fs.writeFile(exe, 'fake'); await fs.writeFile(jtd, jtdBytes('a'));
  const lockPath = path.join(dir, 'runner.lock');
  const run = async (name, options, args = {}) => {
    const fake = pdfLaunch(path.join(dir, `${name}.pdf`), options);
    const adapter = new MacroAdapter({ exe, lockPath, launch: fake.launch, timeoutMs: 1000 });
    try { return { value: await adapter.exportPdf({ jtd, pdf: path.join(dir, `${name}.pdf`), workDir: path.join(dir, name), ...args }), adapter, fake }; }
    catch (error) { return { error, adapter, fake }; }
  };
  const ok = await run('ok', {}, { existing: true });
  assert.equal(ok.value.sheets, 1); assert.equal(ok.value.documentMacros, 0); assert.equal(ok.value.pages, 2); assert.equal(ok.value.warningMode, 0);
  assert.equal(ok.value.jtdUnchanged, true); assert.equal(ok.value.jtdSha256, sha256(jtdBytes('a'))); assert.equal(ok.value.jtdSha256AfterClose, ok.value.jtdSha256);
  const source = ok.fake.seen[0];
  assert.ok(source.indexOf('WarningMode(0)') >= 0 && source.indexOf('WarningMode(0)') < source.indexOf('OpenDocumentFile('));
  assert.ok(source.indexOf('SaveDocument(') < source.indexOf('GetSheetCount()') && source.indexOf('CountMacros(2)') < source.indexOf('%doc.Close(3)'));
  // The sample path (--pdf) is unchanged: no WarningMode and no counts, the same SaveDocument arguments.
  const plain = await run('plain', {});
  assert.equal(plain.value.sheets, undefined);
  assert.ok(!plain.fake.seen[0].includes('WarningMode') && !plain.fake.seen[0].includes('GetSheetCount'));
  const saveCall = s => s.split('\r\n').find(line => line.startsWith('SaveDocument(')).replace(/\(.*?,"",""/, '(<pdf>,"",""');
  assert.equal(saveCall(source), saveCall(plain.fake.seen[0]));
  assert.ok(saveCall(source).endsWith(',23)'));
  const open = await run('open', { status: 'error', phase: 'open', pdf: null }, { existing: true });
  assert.equal(open.error.code, 'ERR_MACRO_EXECUTION'); assert.equal(open.error.details.errorPhase, 'open'); assert.equal(open.adapter.uncertain, false);
  const missing = await run('missing', { pdf: null }, { existing: true });
  assert.equal(missing.error.code, 'ERR_PDF_NOT_WRITTEN');
  const changed = await run('changed', { touch: jtd }, { existing: true });
  assert.equal(changed.error.code, 'ERR_PDF_JTD_CHANGED'); assert.notEqual(changed.error.jtdSha256AfterClose, changed.error.jtdSha256); assert.ok(changed.error.pdf.sha256);
  await assert.rejects(fs.access(lockPath)); // every completed export released the lock
  const timeout = await run('timeout', { never: true }, { existing: true });
  assert.equal(timeout.error.code, 'ERR_MACRO_TIMEOUT'); assert.equal(timeout.adapter.uncertain, true);
  await fs.access(lockPath); // an unknown outcome keeps the lock for a person to inspect
});

// In-process adapter: the behaviour per document comes from the plan, keyed by the copy's name.
function planAdapter(plan) {
  const calls = [];
  return { calls, async waitForExit() { return 0; },
    async exportPdf({ jtd, pdf, workDir, existing, sheetPdfPrefix }) {
      const id = path.basename(jtd, '.jtd'), action = plan[id] ?? 'ok', before = sha256(await fs.readFile(jtd));
      calls.push({ id, existing });
      await fs.mkdir(workDir);
      await fs.writeFile(path.join(workDir, 'runner.txt'), `macro for ${id}`);
      if (action === 'timeout') throw Object.assign(new Error('PDF export timed out; inspect the application before recovery.'), { code: 'ERR_MACRO_TIMEOUT' });
      await fs.writeFile(path.join(workDir, 'result.txt'), utf16(`result for ${id}`));
      const fail = (phase, extra = {}) => Object.assign(new Error(`fake ${phase} failure`), { code: 'ERR_MACRO_EXECUTION', details: { errorPhase: phase }, jtdSha256: before, jtdSha256AfterClose: before, durationMs: 5, ...extra });
      if (action === 'open') throw fail('open');
      if (action === 'pdf') throw fail('pdf');
      const bytes = fakePdf(3);
      await fs.writeFile(pdf, bytes);
      if (action === 'close') throw fail('close');
      if (action === 'inspect') throw fail('inspect');
      // sheetmiddle: sheet 2 of 4 (with text) fails in its own try and sheets 3 and 4 are still saved;
      // sheetempty: the main sheet (no text characters) cannot be saved, the other two are (0.17.2).
      if (action === 'sheetmiddle' || action === 'sheetempty') {
        const count = action === 'sheetmiddle' ? 4 : 3, failing = action === 'sheetmiddle' ? 2 : 1, details = { sheets: String(count), documentMacros: '0' };
        for (let i = 1; i <= count; i++) {
          Object.assign(details, { [`sheet${i}.kind`]: i === 1 ? '1' : '2', [`sheet${i}.caption`]: `Sheet${i}`, [`sheet${i}.characters`]: action === 'sheetempty' && i === 1 ? '0' : String(100 * i) });
          if (i === failing) { Object.assign(details, { [`sheet${i}.errorStep`]: 'save', [`sheet${i}.error`]: 'ファイルに書き込めませんでした。' }); continue; }
          await fs.writeFile(`${sheetPdfPrefix}${i}.pdf`, fakePdf(i));
          details[`sheet${i}.saved`] = '1';
        }
        return { path: pdf, bytes: bytes.length, sha256: sha256(bytes), ...pdfPageCount(bytes), jtdSha256: before, jtdSha256AfterClose: before, jtdUnchanged: true, durationMs: 5, sheets: count, documentMacros: 0, macro: {}, sheetPdfs: await sheetPdfRecords(details, sheetPdfPrefix) };
      }
      // sheets3: three sheets, each saved as <prefix><i>.pdf; sheetfail: the macro stops at sheet 2 of 3
      // (an error outside the sheet's own try) after sheet 1 is saved.
      if (action === 'sheets3' || action === 'sheetfail') {
        const details = { errorPhase: action === 'sheetfail' ? 'sheet 2' : undefined, sheets: '3', documentMacros: '0' };
        for (let i = 1; i <= 3; i++) {
          Object.assign(details, { [`sheet${i}.kind`]: i === 1 ? '1' : '2', [`sheet${i}.caption`]: `Sheet${i}` });
          if (action === 'sheetfail' && i === 2) throw fail('sheet 2', { details });
          await fs.writeFile(`${sheetPdfPrefix}${i}.pdf`, fakePdf(i));
          details[`sheet${i}.saved`] = '1';
        }
        return { path: pdf, bytes: bytes.length, sha256: sha256(bytes), ...pdfPageCount(bytes), jtdSha256: before, jtdSha256AfterClose: before, jtdUnchanged: true, durationMs: 5, sheets: 3, documentMacros: 0, macro: {}, sheetPdfs: await sheetPdfRecords(details, sheetPdfPrefix) };
      }
      const record = { path: pdf, bytes: bytes.length, sha256: sha256(bytes), ...pdfPageCount(bytes), jtdSha256: before, jtdSha256AfterClose: before, jtdUnchanged: true, durationMs: 5, sheets: 1, documentMacros: 0, macro: {}, sheetPdfs: [] };
      if (action === 'changed') { await fs.appendFile(jtd, 'x'); throw Object.assign(new Error('The JTD changed during PDF export.'), { code: 'ERR_PDF_JTD_CHANGED', pdf: record, jtdSha256: before, jtdSha256AfterClose: sha256(await fs.readFile(jtd)), durationMs: 5 }); }
      return record;
    } };
}

test('a 250-document catalog runs one at a time, records each outcome, keeps going on document failures and stops at a timeout', async t => {
  const dir = await scratch(t), inbox = path.join(dir, 'inbox');
  const names = Array.from({ length: 250 }, (_, i) => String(100000 + i));
  const documents = await inputsOf(inbox, names);
  // Damaged inputs: a wrong hash, a missing file and a file that is neither a compound file
  // nor the older Ichitaro format (which is opened: names[6]).
  await fs.appendFile(path.join(inbox, 'inputs', `${names[3]}.jtd`), 'tampered');
  await fs.rm(path.join(inbox, 'inputs', `${names[4]}.jtd`));
  const plain = Buffer.from('not a JTD');
  await fs.writeFile(path.join(inbox, 'inputs', `${names[5]}.jtd`), plain); documents[5].sha256 = sha256(plain);
  const old = Buffer.concat([Buffer.from('444f430000000000', 'hex'), Buffer.from(' Ver5')]);
  await fs.writeFile(path.join(inbox, 'inputs', `${names[6]}.jtd`), old); documents[6].sha256 = sha256(old);
  const plan = { [`doc-${names[10]}`]: 'open', [`doc-${names[11]}`]: 'pdf', [`doc-${names[12]}`]: 'close', [`doc-${names[13]}`]: 'inspect', [`doc-${names[14]}`]: 'changed', [`doc-${names[20]}`]: 'sheets3', [`doc-${names[21]}`]: 'sheetfail', [`doc-${names[23]}`]: 'sheetmiddle', [`doc-${names[24]}`]: 'sheetempty', [`doc-${names[240]}`]: 'timeout' };
  const adapter = planAdapter(plan), windows = [];
  const catalog = catalogOf(documents, 'municipal-r1');
  const before = await fs.readFile(path.join(inbox, 'inputs', `${names[0]}.jtd`));
  const summary = await runPdfCatalog(catalog, inbox, path.join(dir, 'out'), { adapter, ichitaro: { exe: 'fake' }, windows: () => (windows.push(1), { windows: [{ title: '一太郎', className: '#32770', texts: [{ type: 'Text', name: '確認' }] }] }) });
  assert.equal(summary.ok, false);
  assert.equal(summary.results.length, 241); // documents after the timeout were not opened
  assert.deepEqual(summary.stopped, { documentId: `doc-${names[240]}`, outcome: 'TIMEOUT_UNKNOWN_OUTCOME', message: 'PDF export timed out; inspect the application before recovery.' });
  assert.deepEqual(summary.outcomeCounts, { PDF_SAVED: 231, SHEET_PDF_FAILED: 2, INPUT_MISMATCH: 2, NOT_ICHITARO_FORMAT: 1, OPEN_FAILED: 1, PDF_FAILED: 1, CLOSE_FAILED: 1, JTD_CHANGED: 1, TIMEOUT_UNKNOWN_OUTCOME: 1 });
  assert.deepEqual(summary.counts, { VERIFIED: 231, NOT_VERIFIED: 4, MACRO_ERROR: 5, TIMEOUT_UNKNOWN_OUTCOME: 1 });
  for (const result of summary.results) assert.equal(result.reasonCode, PDF_OUTCOMES[result.outcome]);
  // Ichitaro was not started for the damaged inputs, and every macro was for an existing JTD.
  assert.equal(adapter.calls.length, 241 - 3);
  assert.ok(adapter.calls.every(call => call.existing === true));
  const by = id => summary.results.find(result => result.documentId === id);
  const saved = by(`doc-${names[0]}`);
  assert.deepEqual(saved.jtd, { submittedSha256: documents[0].sha256, bytes: before.length, sha256BeforeOpen: documents[0].sha256, sha256AfterClose: documents[0].sha256, unchanged: true });
  assert.equal(saved.pdf.pages, 3); assert.equal(saved.sheets, 1); assert.deepEqual(saved.sheetPdfs, []); assert.equal(saved.documentMacros, 0); assert.ok(saved.durationMs >= 0);
  assert.deepEqual(saved.macro.map(file => file.kind), ['macro-source', 'macro-result']);
  assert.equal(by(`doc-${names[3]}`).error.code, 'HASH_MISMATCH');
  assert.equal(by(`doc-${names[4]}`).error.code, 'ENOENT');
  assert.equal(by(`doc-${names[5]}`).error.code, 'NOT_ICHITARO_FORMAT');
  assert.equal(by(`doc-${names[6]}`).outcome, 'PDF_SAVED');
  assert.equal(by(`doc-${names[10]}`).pdf, null);
  assert.ok(by(`doc-${names[12]}`).pdf.sha256, 'a valid PDF is kept when closing fails');
  assert.equal(by(`doc-${names[13]}`).outcome, 'PDF_SAVED', 'a failing count after the PDF keeps the PDF');
  assert.equal(by(`doc-${names[14]}`).jtd.unchanged, false);
  assert.ok(by(`doc-${names[14]}`).pdf.sha256);
  // 0.17.0: a three-sheet document gets one PDF per sheet beside document.pdf.
  const multi = by(`doc-${names[20]}`);
  assert.equal(multi.outcome, 'PDF_SAVED'); assert.equal(multi.sheets, 3); assert.ok(multi.pdf.sha256);
  assert.deepEqual(multi.sheetPdfs.map(({ sheet, kind, caption, pages }) => [sheet, kind, caption, pages]), [[1, 1, 'Sheet1', 1], [2, 2, 'Sheet2', 2], [3, 2, 'Sheet3', 3]]);
  assert.ok(multi.sheetPdfs.every(sheet => sheet.path.endsWith(`doc-${names[20]}.sheet-${sheet.sheet}.pdf`) && sheet.sha256));
  // A failing sheet keeps document.pdf and the sheets saved before it, and the batch goes on.
  const partial = by(`doc-${names[21]}`);
  assert.deepEqual([partial.outcome, partial.reasonCode, partial.error.phase, partial.sheets], ['SHEET_PDF_FAILED', 'MACRO_ERROR', 'sheet 2', 3]);
  assert.ok(partial.pdf.sha256);
  assert.deepEqual(partial.sheetPdfs.map(sheet => [sheet.sheet, !!sheet.sha256, sheet.reason]), [[1, true, undefined], [2, false, 'NOT_REACHED']]);
  assert.equal(by(`doc-${names[22]}`).outcome, 'PDF_SAVED');
  // 0.17.2: a failing middle sheet does not hide the later sheets.
  const middle = by(`doc-${names[23]}`);
  assert.deepEqual([middle.outcome, middle.reasonCode, middle.error.code, middle.error.phase, middle.sheets], ['SHEET_PDF_FAILED', 'MACRO_ERROR', 'ERR_SHEET_PDF_NOT_SAVED', 'sheet 2', 4]);
  assert.equal(middle.error.message, 'sheet 2 SAVE_FAILED: ファイルに書き込めませんでした。');
  assert.ok(middle.pdf.sha256);
  assert.deepEqual(middle.sheetPdfs.map(sheet => [sheet.sheet, !!sheet.sha256, sheet.characters, sheet.reason ?? null]), [[1, true, 100, null], [2, false, 200, 'SAVE_FAILED'], [3, true, 300, null], [4, true, 400, null]]);
  assert.deepEqual(middle.sheetPdfs[1], { sheet: 2, kind: 2, caption: 'Sheet2', path: null, characters: 200, reason: 'SAVE_FAILED', message: 'ファイルに書き込めませんでした。' });
  // An empty main sheet that cannot be saved is reported on the sheet, and the document stays PDF_SAVED.
  const empty = by(`doc-${names[24]}`);
  assert.deepEqual([empty.outcome, empty.reasonCode, empty.error], ['PDF_SAVED', 'VERIFIED', undefined]);
  assert.deepEqual(empty.sheetPdfs[0], { sheet: 1, kind: 1, caption: 'Sheet1', path: null, characters: 0, reason: 'EMPTY_SHEET_NOT_SAVED', message: 'ファイルに書き込めませんでした。' });
  assert.deepEqual(empty.sheetPdfs.slice(1).map(sheet => [sheet.sheet, !!sheet.sha256]), [[2, true], [3, true]]);
  assert.equal(windows.length, 1);
  assert.equal(by(`doc-${names[240]}`).windows.windows[0].texts[0].name, '確認');
  // The submitted JTDs are not touched: only the copies under jtd/ are opened.
  assert.deepEqual(await fs.readFile(path.join(inbox, 'inputs', `${names[0]}.jtd`)), before);
  assert.deepEqual(await fs.readFile(path.join(dir, 'out', 'jtd', `doc-${names[0]}.jtd`)), before);
  const written = await readJson(path.join(dir, 'out', 'execution-results.json'));
  assert.equal(written.kind, 'pdf-from-jtd'); assert.equal(written.jobCount, 250);
  await assert.rejects(runPdfCatalog(catalog, inbox, path.join(dir, 'out'), { adapter }), { code: 'EEXIST' }); // never overwrites

  // The package carries the PDFs and both hashes of each JTD, but not the JTDs.
  const packaged = spawnSync(process.execPath, ['bin/ichitaro-package.mjs', path.join(dir, 'out'), path.join(dir, 'package')], { encoding: 'utf8' });
  assert.equal(packaged.status, 0, packaged.stderr);
  const manifest = await readJson(path.join(dir, 'package', 'package-manifest.json'));
  assert.equal(manifest.kind, 'pdf-from-jtd'); assert.deepEqual(manifest.runs, []); assert.equal(manifest.documents.length, 241);
  const entry = manifest.documents.find(item => item.documentId === `doc-${names[0]}`);
  assert.deepEqual(entry.jtd, { file: documents[0].file, sha256: documents[0].sha256, bytes: before.length, sha256AfterClose: documents[0].sha256, unchanged: true });
  assert.equal(entry.pdf.path, `documents/doc-${names[0]}/document.pdf`);
  assert.equal(manifest.documents.find(item => item.documentId === `doc-${names[10]}`).pdf, null);
  for (const file of manifest.files) {
    const bytes = await fs.readFile(path.join(dir, 'package', file.path));
    assert.equal(sha256(bytes), file.sha256, file.path); assert.equal(bytes.length, file.bytes);
  }
  assert.ok(!manifest.files.some(file => file.path.endsWith('.jtd')));
  assert.deepEqual(manifest.files.filter(file => /\/sheet-\d+\.pdf$/.test(file.path)).map(file => file.path).sort(), [`documents/doc-${names[20]}/sheet-1.pdf`, `documents/doc-${names[20]}/sheet-2.pdf`, `documents/doc-${names[20]}/sheet-3.pdf`, `documents/doc-${names[21]}/sheet-1.pdf`,
    `documents/doc-${names[23]}/sheet-1.pdf`, `documents/doc-${names[23]}/sheet-3.pdf`, `documents/doc-${names[23]}/sheet-4.pdf`, `documents/doc-${names[24]}/sheet-2.pdf`, `documents/doc-${names[24]}/sheet-3.pdf`]);
  const multiEntry = manifest.documents.find(item => item.documentId === `doc-${names[20]}`);
  assert.equal(multiEntry.sheets, 3);
  assert.deepEqual(multiEntry.sheetPdfs[1], { sheet: 2, kind: 2, caption: 'Sheet2', path: `documents/doc-${names[20]}/sheet-2.pdf`, characters: null, sha256: sha256(fakePdf(2)), bytes: fakePdf(2).length, pages: 2 });
  assert.deepEqual(manifest.documents.find(item => item.documentId === `doc-${names[21]}`).sheetPdfs[1], { sheet: 2, kind: 2, caption: 'Sheet2', path: null, characters: null, reason: 'NOT_REACHED', message: 'The macro stopped at this sheet.' });
  assert.deepEqual(manifest.documents.find(item => item.documentId === `doc-${names[24]}`).sheetPdfs[0], { sheet: 1, kind: 1, caption: 'Sheet1', path: null, characters: 0, reason: 'EMPTY_SHEET_NOT_SAVED', message: 'ファイルに書き込めませんでした。' });
  assert.equal(manifest.documents.find(item => item.documentId === `doc-${names[23]}`).sheetPdfs[2].characters, 300);
  assert.equal(manifest.files.filter(file => file.path.endsWith('/document.pdf')).length, 231 + 4); // PDF_SAVED, the two sheet failures, the close failure and the changed JTD
});

test('0.17.0: with two or more sheets, exportPdf saves each sheet after the default PDF with the same call and reports each one', async t => {
  const dir = await scratch(t), exe = path.join(dir, 'fake.exe'), jtd = path.join(dir, 'a.jtd');
  await fs.writeFile(exe, 'fake'); await fs.writeFile(jtd, jtdBytes('a'));
  const run = async (name, options) => {
    const sheetPdfPrefix = path.join(dir, `${name}.sheet-`);
    const fake = pdfLaunch(path.join(dir, `${name}.pdf`), { ...options, sheetPrefix: sheetPdfPrefix });
    const adapter = new MacroAdapter({ exe, lockPath: path.join(dir, 'runner.lock'), launch: fake.launch, timeoutMs: 1000 });
    try { return { value: await adapter.exportPdf({ jtd, pdf: path.join(dir, `${name}.pdf`), workDir: path.join(dir, name), existing: true, sheetPdfPrefix }), fake, sheetPdfPrefix }; }
    catch (error) { return { error, fake, sheetPdfPrefix }; }
  };
  const three = await run('three', { sheets: '3' });
  assert.deepEqual(three.value.sheetPdfs.map(({ sheet, kind, caption, path: file, pages }) => [sheet, kind, caption, file, pages]),
    [1, 2, 3].map(i => [i, i === 1 ? 1 : 2, `Sheet${i}`, `${three.sheetPdfPrefix}${i}.pdf`, i]));
  const source = three.fake.seen[0].split('\r\n');
  const at = text => source.findIndex(line => line.startsWith(text));
  // The default PDF comes first and is unchanged; the sheet loop follows, with the same SaveDocument arguments.
  assert.ok(at('SaveDocument(') < at('if %sheetCount >= 2 then') && at('if %sheetCount >= 2 then') < at('ChangeCurrentSheet(%i)'));
  assert.ok(source.includes('%item=GetCurrentSheetItem()') && !source.some(line => line.includes('set %item')));
  assert.match(source.find(line => line.includes('& %i & ".pdf"')), /^SaveDocument\(.* & %i & "\.pdf","","",23\)$/);
  assert.ok(at('next') < at('%phase="close"'));
  // One sheet: no sheet PDFs. Without a prefix (--pdf), no sheet loop at all.
  assert.deepEqual((await run('one', { sheets: '1' })).value.sheetPdfs, []);
  const plain = pdfLaunch(path.join(dir, 'plain.pdf'));
  await new MacroAdapter({ exe, lockPath: path.join(dir, 'runner.lock'), launch: plain.launch }).exportPdf({ jtd, pdf: path.join(dir, 'plain.pdf'), workDir: path.join(dir, 'plain') });
  assert.ok(!plain.seen[0].includes('ChangeCurrentSheet'));
  await assert.rejects(new MacroAdapter({ exe, lockPath: path.join(dir, 'runner.lock'), launch: plain.launch }).exportPdf({ jtd, pdf: path.join(dir, 'x.pdf'), workDir: path.join(dir, 'x'), sheetPdfPrefix: path.join(dir, 'x.sheet-') }), /existing JTD only/);
  // An error outside the sheet's own try stops the macro: the error carries what was saved before it.
  const failed = await run('failed', { sheets: '3', failSheet: 2 });
  assert.equal(failed.error.code, 'ERR_MACRO_EXECUTION'); assert.equal(failed.error.details.errorPhase, 'sheet 2');
  assert.deepEqual((await sheetPdfRecords(failed.error.details, failed.sheetPdfPrefix)).map(sheet => [sheet.sheet, sheet.path !== null, sheet.reason ?? null, sheet.message ?? null]), [[1, true, null, null], [2, false, 'NOT_REACHED', 'fake failure']]);
});

test('0.17.2: each sheet is tried in its own try, so a failing middle sheet does not hide the later ones', async t => {
  const dir = await scratch(t), exe = path.join(dir, 'fake.exe'), jtd = path.join(dir, 'a.jtd');
  await fs.writeFile(exe, 'fake'); await fs.writeFile(jtd, jtdBytes('a'));
  const run = async (name, options) => {
    const sheetPdfPrefix = path.join(dir, `${name}.sheet-`), pdf = path.join(dir, `${name}.pdf`);
    const fake = pdfLaunch(pdf, { ...options, sheetPrefix: sheetPdfPrefix });
    const adapter = new MacroAdapter({ exe, lockPath: path.join(dir, 'runner.lock'), launch: fake.launch, timeoutMs: 1000 });
    return { value: await adapter.exportPdf({ jtd, pdf, workDir: path.join(dir, name), existing: true, sheetPdfPrefix }), fake, sheetPdfPrefix, pdf };
  };
  const middle = await run('middle', { sheets: '4', sheetErrors: { 2: { step: 'save', message: 'ファイルに書き込めませんでした。' } } });
  // The macro ends with status ok: document.pdf at the same path, sheets 1, 3 and 4 saved, sheet 2 reported.
  assert.equal(middle.value.path, middle.pdf); assert.ok(middle.value.sha256);
  assert.deepEqual(middle.value.sheetPdfs.map(({ sheet, path: file, characters, reason, message }) => [sheet, file, characters, reason ?? null, message ?? null]), [
    [1, `${middle.sheetPdfPrefix}1.pdf`, 10, null, null], [2, null, 20, 'SAVE_FAILED', 'ファイルに書き込めませんでした。'], [3, `${middle.sheetPdfPrefix}3.pdf`, 30, null, null], [4, `${middle.sheetPdfPrefix}4.pdf`, 40, null, null]]);
  assert.deepEqual(failedSheetPdfs(middle.value.sheetPdfs).map(sheet => sheet.sheet), [2]);
  // The macro: each sheet's steps sit in a try of their own inside the loop, the text count in a nested try
  // before the save, and the default PDF is saved once, before the loop, as before.
  const source = middle.fake.seen[0].split('\r\n');
  const at = (text, from = 0) => source.findIndex((line, i) => i >= from && line.startsWith(text));
  const loop = at('for %i = 1 to %sheetCount'), sheetTry = at('try', loop), change = at('ChangeCurrentSheet(%i)'), countTry = at('try', change), save = at('%step="save"');
  assert.ok(at('SaveDocument(') < loop && loop < sheetTry && sheetTry < change && change < countTry && countTry < at('SelectAll(1)') && at('SelectAll(1)') < save);
  assert.equal(source.filter(line => line.startsWith('SaveDocument(') && !line.includes('& %i &')).length, 1);
  assert.ok(at('CancelAllRange()', countTry) < save && at('end try', countTry) < at('CancelAllRange()', countTry));
  assert.match(source[save + 1], /^SaveDocument\(.* & %i & "\.pdf","","",23\)$/);
  assert.deepEqual(source.slice(at('exception', save), at('next', save) + 1), ['exception', 'case else', 'set %err=MacroEngine.LastError',
    '%result.LinePrint("sheet" & %i & ".errorStep=" & %step)', '%result.LinePrint("sheet" & %i & ".error=" & %err.Message)', 'end try', 'next']);
  // An empty main sheet that cannot be saved is reported without failing the document; a sheet that
  // could not be switched to, a save without a PDF and an unread text count are each reported too.
  const empty = await run('empty', { sheets: '3', characters: { 1: 0 }, sheetErrors: { 1: { step: 'save', message: 'ファイルに書き込めませんでした。' } } });
  assert.deepEqual(empty.value.sheetPdfs[0], { sheet: 1, kind: 1, caption: 'Sheet1', path: null, characters: 0, reason: 'EMPTY_SHEET_NOT_SAVED', message: 'ファイルに書き込めませんでした。' });
  assert.deepEqual(failedSheetPdfs(empty.value.sheetPdfs), []);
  const mixed = await run('mixed', { sheets: '4', characters: { 3: 'error' }, sheetErrors: { 1: { step: 'change', message: 'fake change failure' }, 3: { step: 'save', message: 'ファイルに書き込めませんでした。' } } });
  assert.deepEqual(mixed.value.sheetPdfs.map(({ sheet, kind, characters, charactersError, reason, message }) => [sheet, kind, characters, charactersError ?? null, reason ?? null, message ?? null]), [
    [1, null, null, null, 'SHEET_FAILED', 'change: fake change failure'], [2, 2, 20, null, null, null], [3, 2, null, 'fake count failure', 'SAVE_FAILED', 'ファイルに書き込めませんでした。'], [4, 2, 40, null, null, null]]);
  assert.deepEqual(failedSheetPdfs(mixed.value.sheetPdfs).map(sheet => sheet.sheet), [1, 3]);
  const notWritten = await sheetPdfRecords({ sheets: '2', 'sheet1.kind': '1', 'sheet1.characters': '5', 'sheet1.saved': '1', 'sheet2.kind': '2', 'sheet2.characters': '0', 'sheet2.saved': '1' }, path.join(dir, 'absent.sheet-'));
  assert.deepEqual(notWritten.map(sheet => sheet.reason), ['PDF_NOT_WRITTEN', 'PDF_NOT_WRITTEN']);
});
