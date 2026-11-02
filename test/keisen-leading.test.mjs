import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compileCatalog, validateCatalog } from '../src/sample-catalog.mjs';
import { expandExperiment } from '../src/experiment.mjs';
import { compileSample } from '../src/adapters/macro.mjs';
import { keisenMacro, validateKeisenCanvas, verifyKeisenReadback, KEISEN_SIDES } from '../src/keisen.mjs';

// CR-009: the lab's example br4-lead2 and variants.
const table = { kind: 'keisen-table', rows: 2, columns: 4, lineType: 1, color: 'R0G0B0' };
const sample = (id, document) => ({ id, title: id, purpose: '罫線表 2×4 の前に段落', feature: 'keisen-table', testIntent: 'comparison',
  expected: [{ property: 'table.rows', value: 2 }, { property: 'table.columns', value: 4 }], document });
const compile = document => compileCatalog({ schemaVersion: 1, id: 'cr009', samples: [sample('br4-lead2', document)] }).jobs[0];
const lead = [{ text: '一つ目の段落です。' }, { text: '' }, { text: '大きい字', sizePt: 15, spacing: { unit: 'mm', before: 2 } }];

test('CR-009: leading paragraphs come first in the text and move the canvas down; without them nothing changes', () => {
  const plain = compile(table), led = compile({ ...table, leadingParagraphs: lead, font: { sizePt: 11 } });
  assert.equal(plain.recipe.keisenCanvas.leading, undefined);
  assert.deepEqual(led.recipe.keisenCanvas, { ...plain.recipe.keisenCanvas, leading: [{ text: '一つ目の段落です。' }, { text: '' }, { text: '大きい字', size: 15, spacing: { before: 2, after: 0, unit: 1 } }] });
  assert.equal(led.recipe.text, ['一つ目の段落です。', '', '大きい字', plain.recipe.text].join('\r\n'));
  const variant = led.recipe.samples.find(item => item.id === 'br4-lead2');
  assert.deepEqual(variant.features, { layout: { orientation: 1 }, font: { size: 11, sizeUnit: 3 } });
  assert.deepEqual(variant.keisenOperations, plain.recipe.samples.find(item => item.id === 'br4-lead2').keisenOperations); // the same table, in canvas coordinates
  assert.deepEqual(led.capabilities.sort(), ['document-font', 'keisen-table']);
  // With a style, the font joins the shared base.
  const styled = compile({ ...table, leadingParagraphs: lead, font: { sizePt: 11 }, style: { chars: 40, lines: 40, marginTop: 30, marginBottom: 30, marginLeft: 30, marginRight: 30, layoutPriority: 'counts' } });
  assert.equal(styled.recipe.samples.find(item => item.id === 'br4-lead2').features.font.size, 11);
  assert.equal(styled.recipe.samples.find(item => item.id === 'br4-lead2').features.font.japaneseName, '游明朝');
  // A long paragraph may wrap (CR-009 question 4); what clearly cannot leave the table on page 1 is refused.
  assert.equal(compile({ ...table, leadingParagraphs: [{ text: 'あ'.repeat(41) }, { text: 'い'.repeat(33), spacing: { unit: 'percent', after: 50 } }] }).recipe.keisenCanvas.leading[1].spacing.unit, 100);
  assert.throws(() => compile({ ...table, leadingParagraphs: Array.from({ length: 8 }, () => ({ text: 'あ'.repeat(200), sizePt: 18 })) }), /more than the 40 lines of the first page/);
  assert.throws(() => compile({ ...table, leadingParagraphs: [{ text: 'あ', spacing: { unit: 'mm', before: 12 } }] }), /spacing in mm must be 0..10/);
  assert.throws(() => compile({ ...table, leadingParagraphs: [{ text: 'あ'.repeat(201) }] }), { message: `$.samples[0].document.leadingParagraphs[0].text: string length 201 is outside 0..200 (got "${'あ'.repeat(40)}"…)` });
  assert.throws(() => compile({ ...table, leadingParagraphs: [] }), { message: '$.samples[0].document.leadingParagraphs: array length 0 is outside 1..8' });
  assert.throws(() => compile({ ...table, leadingParagraphs: [{ text: '空 白' }] }), { message: '$.samples[0].document.leadingParagraphs[0].text: does not match the required form: 0..200 BMP characters without whitespace, combining marks or characters of Unicode category C (control, format, private use, unassigned); empty makes a blank line (got "空 白")' });
});

test('CR-009: every table coordinate is shifted by the leading lines; sizes are set and every leading line is read back', () => {
  const job = compile({ ...table, leadingParagraphs: lead });
  const plan = expandExperiment(job.recipe), spec = plan.samples.find(item => item.id === 'br4-lead2');
  const canvas = validateKeisenCanvas(plan.keisenCanvas, plan.text);
  const shifted = keisenMacro({ canvas, operations: spec.keisenOperations, q: JSON.stringify });
  const plainCanvas = { rows: canvas.rows, columns: canvas.columns };
  const plain = keisenMacro({ canvas: plainCanvas, operations: spec.keisenOperations, q: JSON.stringify });
  // Every table Jump is the plain one plus %ko, the page line before the canvas read at run time.
  const tableJumps = shifted.apply.filter(line => line.startsWith('Jump(1,'));
  assert.deepEqual(tableJumps, plain.apply.filter(line => line.startsWith('Jump(1,')).map(line => line.replace(/^Jump\(1,(\d+|%\w+),/, 'Jump(1,$1+%ko,')));
  const offset = shifted.apply.indexOf('%ko=GetRow()-1');
  assert.deepEqual(shifted.apply.slice(offset - 2, offset), ['JumpStart()', 'NextParagraph(3)']);
  assert.ok(offset < shifted.apply.findIndex(line => line.startsWith('KeisenMode')));
  // The size and spacing of the third paragraph are set on it, each under its own
  // selection (CR-011: CharacterAttribute leaves no range), before the offset is read.
  const size = shifted.apply.indexOf('CharacterAttribute(,,,,15)');
  const select = ['CancelMode()', 'CancelAllRange()', 'JumpStart()', 'NextParagraph(2)', 'RangeMode(3)', 'RangeStart()', 'RangeEnd(1,1)'];
  assert.deepEqual(shifted.apply.slice(size - 7, size + 11), [...select, 'CharacterAttribute(,,,,15)', 'CancelAllRange()', ...select, 'ParagraphAttribute(,,,,,,,,,,2,0,1)', 'CancelAllRange()']);
  assert.ok(size < offset && !shifted.apply.some(line => /CharacterAttribute\(,,,,\d/.test(line) && line !== 'CharacterAttribute(,,,,15)'));
  const snap = shifted.snapshot('reopened');
  assert.ok(snap.indexOf('%ko=GetRow()-1') < snap.findIndex(line => line.startsWith('Jump(1,')));
  // The readback walks each leading line and the canvas's first line.
  const readback = shifted.snapshot('reopened').join('\n');
  for (const key of ['keisen.leading.reopened.1.char.8', 'keisen.leading.reopened.2.endType', 'keisen.leading.reopened.3.size.0', 'keisen.leading.reopened.3.startRow', 'keisen.leading.reopened.3.endRow', 'keisen.leading.reopened.3.spaceBefore', 'keisen.leading.reopened.canvas.row', 'keisen.leading.reopened.canvas.top']) assert.ok(readback.includes(key), key);
  // In the whole sample macro, the document text holds the leading paragraphs.
  const root = path.resolve('cr009-macro');
  const source = compileSample({ nonce: '12345678-1234-1234-1234-123456789abc', output: path.join(root, 'document.jtd'), resultPath: path.join(root, 'r.txt'), bodyPath: path.join(root, 'b.txt'), donePath: path.join(root, 'd.txt'),
    text: plan.text, settings: {}, features: spec.features, keisenCanvas: plan.keisenCanvas, keisenOperations: spec.keisenOperations });
  assert.ok(source.includes('KeisenMode(2,1,1)'));
});

test('CR-009: the leading readback checks characters, sizes, spacing, the paragraph ends and the lines each paragraph spans', () => {
  const canvas = { rows: 7, columns: 13, leading: [{ text: 'あい' }, { text: '' }, { text: '大', size: 15, spacing: { before: 2, after: 0, unit: 1 } }] };
  const meta = {};
  // A blank table-free canvas readback for the plain grid (initial, before-save, reopened).
  for (const stage of ['initial', 'before-save', 'reopened']) for (let r = 1; r <= 7; r++) for (let c = 1; c <= 13; c++) {
    for (const s of KEISEN_SIDES) for (const f of ['線種', '線色', '背景色']) meta[`keisen.${stage}.grid.${r}.${c}.${s}.${f}`] = f === '線色' ? 'R0G0B0' : '0';
    for (const s of ['全角上', '全角下', '半角上', '半角下']) meta[`keisen.${stage}.grid.${r}.${c}.${s}面取り`] = '0';
  }
  for (const stage of ['before-save', 'reopened']) {
    const put = (n, chars, size, end, top, rows, spacing = ['', '', '']) => {
      const pre = `keisen.leading.${stage}.${n}`;
      [...chars].forEach((c, k) => { meta[`${pre}.char.${k}`] = c; meta[`${pre}.type.${k}`] = '21'; meta[`${pre}.size.${k}`] = String(size); });
      Object.assign(meta, { [`${pre}.endType`]: end, [`${pre}.top`]: String(top), [`${pre}.bottom`]: String(top + 5), [`${pre}.page`]: '1',
        [`${pre}.startRow`]: String(rows[0]), [`${pre}.endRow`]: String(rows[1]), [`${pre}.spaceBefore`]: spacing[0], [`${pre}.spaceAfter`]: spacing[1], [`${pre}.spaceUnit`]: spacing[2] });
    };
    // The first paragraph wraps over two lines.
    put(1, 'あい', 10.5, '10', 30, [1, 2]); put(2, '', 10.5, '10', 41.8, [3, 3]); put(3, '大', 15, '10', 49.7, [4, 4], ['2', '0', '1']);
    Object.assign(meta, { [`keisen.leading.${stage}.canvas.row`]: '5', [`keisen.leading.${stage}.canvas.top`]: '57.1', [`keisen.leading.${stage}.canvas.bottom`]: '62', [`keisen.leading.${stage}.canvas.page`]: '1' });
  }
  const ok = verifyKeisenReadback(meta, { canvas, operations: [] });
  assert.deepEqual(ok.differences, []);
  assert.equal(ok.proof.passed, true);
  assert.deepEqual(ok.proof.leadingProof.positions.reopened.map(p => p.startRow ?? p.row), [1, 3, 4, 5]);
  assert.deepEqual(ok.proof.leadingProof.positions.reopened.map(p => p.lines), [2, 1, 1, undefined]);
  assert.equal(ok.snapshots.reopened.leading.paragraphs[2].characters[0].size, 15);
  assert.deepEqual(ok.snapshots.reopened.leading.paragraphs[2].spacing, { before: 2, after: 0, unit: 1 });
  const fields = changes => verifyKeisenReadback({ ...meta, ...changes }, { canvas, operations: [] }).differences.map(d => `${d.phase}:${d.field}`);
  assert.deepEqual(fields({ 'keisen.leading.reopened.3.size.0': '10.5' }), ['reopened:leading.3.size.0', 'reopened:leading']);
  assert.deepEqual(fields({ 'keisen.leading.before-save.1.endType': '21' }), ['before-save:leading.1.end']); // not the paragraph end
  assert.deepEqual(fields({ 'keisen.leading.reopened.3.spaceBefore': '0' }), ['reopened:leading.3.spacing.before', 'reopened:leading']);
  assert.deepEqual(fields({ 'keisen.leading.reopened.2.startRow': '4', 'keisen.leading.reopened.2.endRow': '4' }), ['reopened:leading.2.startRow', 'reopened:leading.3.startRow', 'reopened:leading']);
  assert.deepEqual(fields({ 'keisen.leading.before-save.canvas.row': '6' }), ['before-save:leading.canvas.row']);
  assert.deepEqual(fields({ 'keisen.leading.reopened.canvas.page': '2' }), ['reopened:leading.canvas.page']);
  assert.deepEqual(fields({ 'keisen.leading.reopened.1.char.1': 'う' }), ['reopened:leading.1.char.1', 'reopened:leading']);
  assert.throws(() => verifyKeisenReadback({ ...meta, 'keisen.leading.reopened.canvas.top': undefined }, { canvas, operations: [] }), /missing leading position/);
});

test('CR-011: size and spacing on one paragraph select it twice; size only or spacing only is unchanged from 0.20.1', () => {
  const apply = leading => keisenMacro({ canvas: { rows: 7, columns: 13, leading }, operations: [], q: JSON.stringify }).apply;
  const before = apply => apply.slice(0, apply.indexOf('%ko=GetRow()-1') - 4);
  const select = ['CancelMode()', 'CancelAllRange()', 'JumpStart()', 'RangeMode(3)', 'RangeStart()', 'RangeEnd(1,1)'];
  // The 0.20.1 macros for one attribute (br4-s165, br4-sp-b15 passed with them).
  assert.deepEqual(before(apply([{ text: '表の前の段落', size: 16.5 }])), [...select, 'CharacterAttribute(,,,,16.5)', 'CancelAllRange()']);
  assert.deepEqual(before(apply([{ text: '表の前の段落', spacing: { before: 1.5, after: 0, unit: 1 } }])), [...select, 'ParagraphAttribute(,,,,,,,,,,1.5,0,1)', 'CancelAllRange()']);
  // br4-s165-b2: both, each under a fresh selection; the size first, as before.
  assert.deepEqual(before(apply([{ text: '表の前の段落', size: 16.5, spacing: { before: 2, after: 0, unit: 1 } }])),
    [...select, 'CharacterAttribute(,,,,16.5)', 'CancelAllRange()', ...select, 'ParagraphAttribute(,,,,,,,,,,2,0,1)', 'CancelAllRange()']);
  // An empty paragraph has no characters to size; its spacing is still set.
  assert.deepEqual(before(apply([{ text: '', size: 16.5, spacing: { before: 2, after: 0, unit: 1 } }])), [...select, 'ParagraphAttribute(,,,,,,,,,,2,0,1)', 'CancelAllRange()']);
});

test('CR-009: the canonical example validates', async () => {
  const catalog = JSON.parse(await fs.readFile('examples/agent/35-keisen-table-leading.json', 'utf8'));
  const result = validateCatalog(catalog);
  assert.ok(result.capabilities.includes('keisen-table'));
  assert.ok(catalog.samples.some(item => item.document.leadingParagraphs?.some(p => p.sizePt)) && catalog.samples.some(item => item.document.leadingParagraphs?.some(p => p.text === '')));
});
