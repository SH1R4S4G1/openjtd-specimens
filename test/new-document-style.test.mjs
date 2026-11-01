import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileCatalog, validateCatalog } from '../src/sample-catalog.mjs';
import { expandExperiment } from '../src/experiment.mjs';
import { compileSample, MacroAdapter } from '../src/adapters/macro.mjs';
import { runMacroExperiment } from '../src/macro-run.mjs';

// CR-001: document.styleSource "new-document" keeps the style of a new document.
const text = '本文の途中に漢字を置いた例です。';
const ruby = { capability: 'ruby', range: { start: 6, end: 8, text: '漢字' }, parameters: { reading: 'かんじ', placement: 'above', alignment: 'distributed' } };
const catalog = (document, extra = {}) => ({ schemaVersion: 1, id: 'new-document', samples: [{ id: 'nd', title: 'nd', purpose: '新規文書の形', feature: document.annotations ? 'ruby' : 'document-style-source',
  expected: [{ property: 'documentStyle.source', value: 'new-document' }], ...extra, document: { kind: 'text', text, styleSource: 'new-document', ...document } }] });
const root = path.resolve('tmp/new-document-test');
const files = { nonce: '12345678-1234-1234-1234-123456789abc', output: path.join(root, 'document.jtd'), resultPath: path.join(root, 'result.txt'), bodyPath: path.join(root, 'body.txt'), donePath: path.join(root, 'done.txt') };
// Setter statements start a line; getters are GetDocumentStyle*.
const setterLines = source => source.split('\r\n').filter(line => /^(Set)?DocumentStyle\w*\(/.test(line));

test('styleSource compiles to a recipe without defaults, settings or features, and no setter reaches the macro', () => {
  for (const input of [catalog({}, { control: true }), catalog({ annotations: [ruby] }), catalog({ text: '一段落目\n二段落目' })]) {
    const [job] = compileCatalog(input).jobs;
    assert.equal(job.recipe.styleSource, 'new-document');
    assert.equal(Object.hasOwn(job.recipe, 'defaults'), false);
    const plan = expandExperiment(job.recipe);
    assert.equal(plan.styleSource, 'new-document');
    for (const sample of plan.samples) {
      assert.deepEqual(sample.settings, {});
      assert.equal(sample.features, undefined);
      const source = compileSample({ ...files, text: plan.text, settings: sample.settings, features: {}, captureFeatures: true, targets: plan.targets, operations: sample.operations ?? [] });
      assert.deepEqual(setterLines(source), [], sample.id);
      assert.ok(source.includes('GetDocumentStyleLayout()') && source.includes('SaveDocument('));
    }
  }
  // The same body with an explicit style still sets the style (the two paths differ).
  const explicit = compileCatalog({ ...catalog({}), samples: [{ ...catalog({}).samples[0], feature: 'document-style', document: { kind: 'text', text, style: { chars: 40, lines: 40, marginTop: 30, marginBottom: 30, marginLeft: 30, marginRight: 30, layoutPriority: 'counts' } } }] });
  const sample = expandExperiment(explicit.jobs[0].recipe).samples[1];
  assert.ok(setterLines(compileSample({ ...files, text, settings: sample.settings, features: sample.features, layoutPriority: sample.layoutPriority })).length > 0);
});

test('styleSource cannot combine with any field that sets the document style', () => {
  for (const [key, value] of Object.entries({ style: { chars: 40, lines: 40, marginTop: 30, marginBottom: 30, marginLeft: 30, marginRight: 30, layoutPriority: 'counts' },
    font: { sizePt: 12 }, page: { paper: 'A4', orientation: 'portrait' }, writingMode: 'horizontal', columnFormat: { gapMm: 5 }, pageNumber: { position: 'bottom-center' }, typesetting: { kinsoku: true } })) {
    assert.throws(() => validateCatalog(catalog({ [key]: value })), new RegExp(`styleSource cannot combine with ${key}|\\$\\.samples`), key);
  }
  assert.throws(() => validateCatalog({ ...catalog({}), samples: [{ ...catalog({}).samples[0], document: { kind: 'paragraphs', text: 'a\nb', styleSource: 'new-document', paragraphFormats: [{ paragraph: 0, alignment: 'center' }] } }] }), { message: '$.samples[0].document: unknown field styleSource' });
  assert.throws(() => validateCatalog(catalog({ style: { chars: 40, lines: 40, marginTop: 30, marginBottom: 30, marginLeft: 30, marginRight: 30, layoutPriority: 'counts' } })), /styleSource cannot combine with style: each sets the document style/);
  assert.throws(() => validateCatalog(catalog({ styleSource: 'template' })), { message: '$.samples[0].document.styleSource: must be one of new-document' });
});

test('the internal recipe refuses defaults, settings and features next to styleSource', () => {
  const base = { schemaVersion: 1, name: 'nd', text, styleSource: 'new-document', samples: [{ id: 'nd', settings: {} }] };
  assert.equal(expandExperiment(base).samples.length, 2);
  assert.throws(() => expandExperiment({ ...base, defaults: { chars: 40, lines: 40, characterSpacing: 1, lineSpacing: 60, marginTop: 30, marginBottom: 30, marginLeft: 30, marginRight: 30 } }), /must be omitted with styleSource/);
  assert.throws(() => expandExperiment({ ...base, samples: [{ id: 'nd', settings: { chars: 40 } }] }), /must be empty with styleSource/);
  assert.throws(() => expandExperiment({ ...base, samples: [{ id: 'nd', settings: {}, features: { layout: { orientation: 1 } } }] }), /cannot combine with styleSource/);
  assert.throws(() => expandExperiment({ ...base, styleSource: 'template' }), /must be new-document/);
});

test('the run passes styleSource and empty settings to the adapter and records it as requested', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'new-document-run-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [];
  const adapter = { connect: async () => ({ test: true }), createSample: async args => {
    calls.push(args);
    await fs.writeFile(args.sample.documentPath, 'fixture JTD');
    const observed = { settings: { chars: 40 }, fullName: args.sample.documentPath };
    return { source: 'fixture', resultBytes: Buffer.from('﻿fixture', 'utf16le'), observed: { 'before-save': observed, reopened: observed }, body: args.text, launch: {}, durationMs: 1,
      verification: { method: 'macro-getter', passed: true, reopened: true, bodyMatches: true, differences: [] } };
  } };
  const [job] = compileCatalog(catalog({ annotations: [ruby] })).jobs;
  const result = await runMacroExperiment(job.recipe, { adapter, outputRoot: dir });
  assert.deepEqual(calls.map(call => [call.styleSource, call.settings, call.features, call.layoutPriority]), [['new-document', {}, {}, 'preserve'], ['new-document', {}, {}, 'preserve']]);
  const sample = JSON.parse(await fs.readFile(path.join(result.runDir, 'samples', 'baseline', 'manifest.json'), 'utf8'));
  assert.equal(sample.requested.styleSource, 'new-document');
  assert.equal(sample.requested.chars, undefined);
});

test('the adapter refuses settings or features with styleSource before launching', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'new-document-adapter-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'fake.exe'), 'fake');
  let launches = 0;
  const adapter = new MacroAdapter({ exe: path.join(dir, 'fake.exe'), lockPath: path.join(dir, 'lock'), launch: async () => { launches++; } });
  const sample = { dir, documentPath: path.join(dir, 'document.jtd') };
  for (const extra of [{ settings: { chars: 40 } }, { features: { layout: { orientation: 1 } } }, { layoutPriority: 'counts' }]) {
    await assert.rejects(adapter.createSample({ sample, styleSource: 'new-document', text, settings: {}, ...extra }), /styleSource new-document allows/);
  }
  assert.equal(launches, 0);
});
