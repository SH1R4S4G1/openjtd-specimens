import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileCatalog, validateCatalog } from '../src/sample-catalog.mjs';
import { expandExperiment } from '../src/experiment.mjs';
import { compileSample, macroString } from '../src/adapters/macro.mjs';
import { runMacroExperiment } from '../src/macro-run.mjs';
import { verifyBodyParagraphs, bodyParagraphsMacro } from '../src/body-paragraphs.mjs';
import { walkedParagraphs } from '../src/ranges.mjs';

// CR-003: plain bodies over 2000 characters.
const paragraph = (n, length) => { let s = ''; while (s.length < length) s += `第${n}段落の本文。`; return s.slice(0, length - 1) + '終'; };
const long = (count, length) => Array.from({ length: count }, (_, i) => paragraph(i + 1, length)).join('\n');
const catalog = (document, feature = 'plain-text') => ({ schemaVersion: 1, id: 'long-text', samples: [{ id: 'long', title: 'long', purpose: '長い本文', feature,
  expected: [{ property: 'text.paragraphCount', value: 3 }], document: { kind: 'text', ...document } }] });
const root = path.resolve('tmp/long-text-test');
const files = { nonce: '12345678-1234-1234-1234-123456789abc', output: path.join(root, 'document.jtd'), resultPath: path.join(root, 'result.txt'), bodyPath: path.join(root, 'body.txt'), donePath: path.join(root, 'done.txt') };

test('a text over 2000 characters compiles to a paragraph walk instead of the per-character walk', () => {
  for (const document of [{ text: long(3, 900) }, { text: long(1, 2500) }, { text: long(3, 900), styleSource: 'new-document' }, { text: long(3, 900), font: { sizePt: 12 } }]) {
    const [job] = compileCatalog(catalog(document)).jobs;
    assert.equal(job.recipe.bodyCheck, 'paragraph-ends');
    assert.equal(job.recipe.targets, undefined);
    const plan = expandExperiment(job.recipe);
    const source = compileSample({ ...files, bodyParagraphs: true, text: plan.text, settings: {}, features: plan.samples[1].features ?? {} });
    assert.equal(source.split('\r\n').filter(line => line === 'NextParagraph(1)').length, 4); // two per walk, before save and after reopening
    assert.ok(!source.includes('range.'));
  }
  // Up to 2000 characters a multi-paragraph body keeps the per-character walk.
  assert.ok(compileCatalog(catalog({ text: long(3, 600) })).jobs[0].recipe.targets);
  assert.equal(compileCatalog(catalog({ text: long(3, 600) })).jobs[0].recipe.bodyCheck, undefined);
});

test('a long text refuses vertical writing, too many paragraphs and more than 60000 characters', () => {
  assert.throws(() => validateCatalog(catalog({ text: long(3, 900), writingMode: 'vertical' })), /vertical writing requires a text of at most 2000/);
  assert.throws(() => validateCatalog(catalog({ text: long(1001, 3) })), /1\.\.1000 nonempty paragraphs/);
  assert.throws(() => validateCatalog(catalog({ text: 'あ'.repeat(60001) })), { code: 'ERR_SAMPLE_SCHEMA' });
  assert.equal(validateCatalog(catalog({ text: long(250, 200) })).ok, true);
  assert.throws(() => expandExperiment({ schemaVersion: 1, name: 'x', text: 'a\n\nb', styleSource: 'new-document', bodyCheck: 'paragraph-ends', samples: [{ id: 's', settings: {} }] }), /nonempty paragraphs/);
  assert.throws(() => compileSample({ ...files, bodyParagraphs: true, text: 'ab', settings: {}, features: { layout: { orientation: 2 } } }), /horizontal text and text ranges only/);
});

test('annotations in a long text walk only the paragraphs that hold them', () => {
  const text = long(250, 200), paragraphs = text.split('\n');
  const offset = p => paragraphs.slice(0, p).reduce((n, s) => n + s.length + 1, 0);
  const annotation = (p, k, capability, parameters) => ({ capability, range: { start: offset(p) + k, end: offset(p) + k + 2, text: paragraphs[p].slice(k, k + 2) }, parameters });
  const input = catalog({ text, styleSource: 'new-document', annotations: [annotation(200, 3, 'ruby', { reading: 'だんらく' }), annotation(240, 5, 'character-font-style', { style: 'bold' })] }, 'ruby');
  const [job] = compileCatalog(input).jobs;
  assert.equal(job.recipe.bodyCheck, 'paragraph-ends');
  assert.equal(job.recipe.targets.length, 2);
  assert.deepEqual(walkedParagraphs(job.recipe.text, job.recipe.targets), [200, 240]);
  const plan = expandExperiment(job.recipe), sample = plan.samples[1];
  const source = compileSample({ ...files, bodyParagraphs: true, text: plan.text, settings: {}, features: {}, captureFeatures: true, targets: plan.targets, operations: sample.operations });
  // The per-character walk reaches only paragraphs 200 and 240; the paragraph walk covers the body.
  const reached = new Set([...source.matchAll(/^NextParagraph\((\d+)\)$/gm)].map(m => Number(m[1])).filter(p => p !== 1)); // NextParagraph(1) is the body walk
  assert.deepEqual([...reached].sort((a, b) => a - b), [200, 240]);
  assert.ok(source.includes('bodyParagraph.') && source.includes('range.'));
  // Up to 2000 characters every paragraph is still walked.
  assert.deepEqual(walkedParagraphs(long(3, 600), [{ start: 0, end: 1 }]), [0, 1, 2]);
  // Annotated paragraphs of a long body total at most 2000 characters.
  const wide = long(3, 1100), wideParagraphs = wide.split('\n');
  const spread = [0, 1].map(p => ({ capability: 'character-font-style', range: { start: p * 1101, end: p * 1101 + 2, text: wideParagraphs[p].slice(0, 2) }, parameters: { style: 'bold' } }));
  assert.throws(() => validateCatalog(catalog({ text: wide, annotations: spread }, 'character-font-style')), /hold targets must total at most 2000 characters/);
});

// Meta lines as the macro writes them, from a model of the document.
function walkMeta(paragraphs, stages = ['before-save', 'reopened']) {
  const meta = {};
  for (const stage of stages) paragraphs.forEach((p, k) => {
    const last = k === paragraphs.length - 1, at = (c, t) => `${c}/${t}/1/${k + 1}/1`;
    Object.assign(meta, { [`bodyParagraph.${stage}.${k}.start`]: at(p[0], 21), [`bodyParagraph.${stage}.${k}.next`]: last ? at('', 0) : at(paragraphs[k + 1][0], 21),
      [`bodyParagraph.${stage}.${k}.left1`]: at('', last ? 0 : 10), [`bodyParagraph.${stage}.${k}.left2`]: at(p.at(-1), 21) });
  });
  return meta;
}
const lines = (paragraphs, width = 40) => paragraphs.flatMap(p => p.match(new RegExp(`.{1,${width}}`, 'gu'))).join('\n');

test('the paragraph walk proof passes for the requested structure and fails for extra, missing or moved breaks', () => {
  const requested = ['春の野に出て若菜を摘む人の姿が見える。'.repeat(5), '遠くの山には雪が残る。', '川の水は冷たい/と書く。'.repeat(4)];
  const text = requested.join('\n');
  const good = verifyBodyParagraphs(walkMeta(requested), { text, body: lines(requested) });
  assert.equal(good.proof.passed, true, JSON.stringify(good.differences));
  assert.equal(good.proof.paragraphs, 3);
  assert.equal(good.snapshots.reopened.length, 3);
  // An extra break inside the first paragraph: the walk finds four paragraphs.
  const split = [requested[0].slice(0, 30), requested[0].slice(30), ...requested.slice(1)];
  const extra = verifyBodyParagraphs(walkMeta(split), { text, body: lines(split) });
  assert.equal(extra.proof.passed, false);
  // A missing break: two requested paragraphs read back as one.
  const merged = [requested[0] + requested[1], requested[2]];
  assert.equal(verifyBodyParagraphs(walkMeta(merged), { text, body: lines(merged) }).proof.passed, false);
  // The walk agrees but the lines do not split at a requested end.
  assert.equal(verifyBodyParagraphs(walkMeta(requested), { text, body: lines([requested.join('')]) }).proof.passed, false);
  // Missing readback for a stage.
  assert.equal(verifyBodyParagraphs(walkMeta(requested, ['reopened']), { text, body: lines(requested) }).proof.passed, false);
  // The walk macro has one loop per stage and writes the four slots.
  const source = bodyParagraphsMacro({ text, q: macroString }).snapshot('reopened').join('\r\n');
  for (const slot of ['start', 'next', 'left1', 'left2']) assert.ok(source.includes(`.${slot}=`), slot);
});

test('the run passes the paragraph walk and a longer timeout to the adapter', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'long-text-run-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [];
  const adapter = { connect: async () => ({ test: true }), createSample: async args => {
    calls.push(args);
    await fs.writeFile(args.sample.documentPath, 'fixture JTD');
    const observed = { settings: {}, fullName: args.sample.documentPath };
    return { source: 'fixture', resultBytes: Buffer.from('﻿fixture', 'utf16le'), observed: { 'before-save': observed, reopened: observed }, body: args.text, launch: {}, durationMs: 1,
      verification: { method: 'macro-getter', passed: true, reopened: true, bodyMatches: true, differences: [] } };
  } };
  const [job] = compileCatalog(catalog({ text: long(250, 200), styleSource: 'new-document' })).jobs;
  await runMacroExperiment(job.recipe, { adapter, outputRoot: dir });
  assert.deepEqual(calls.map(call => call.bodyParagraphs), [true, true]);
  assert.equal(calls[0].timeoutMs, 30000 + (50000 + 249 * 2) * 2 + 250 * 60); // CRLF-normalized length
});
