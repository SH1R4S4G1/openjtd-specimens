import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compileCatalog, validateCatalog } from '../src/sample-catalog.mjs';
import { expandExperiment } from '../src/experiment.mjs';
import { compileSample } from '../src/adapters/macro.mjs';
import { COLUMN_BASE_FEATURES } from '../src/document-columns.mjs';

// CR-008: the lab's example br2-left24, with and without a document style.
const table = { kind: 'keisen-table', rows: 2, columns: 4, lineType: 1, color: 'R0G0B0' };
const style = { chars: 40, lines: 40, marginTop: 30, marginBottom: 30, marginLeft: 24, marginRight: 30, layoutPriority: 'counts' };
const sample = document => ({ id: 'br2-left24', title: 'br2-left24', purpose: '罫線表 2×4、左の余白だけ 24mm', feature: 'keisen-table', testIntent: 'comparison',
  expected: [{ property: 'table.rows', value: 2 }, { property: 'table.columns', value: 4 }], document });
const compile = document => compileCatalog({ schemaVersion: 1, id: 'cr008', samples: [sample(document)] }).jobs[0];

test('CR-008: a keisen-table sample takes an optional document style; without it the compiled sample is unchanged', () => {
  const plain = compile(table), styled = compile({ ...table, style });
  // Without a style: no settings of its own, no priority, horizontal only, exactly as before CR-008.
  const plainVariant = plain.recipe.samples.find(item => item.id === 'br2-left24');
  assert.deepEqual([plainVariant.settings, plainVariant.layoutPriority, plainVariant.features], [{}, undefined, { layout: { orientation: 1 } }]);
  assert.deepEqual(plain.capabilities, ['keisen-table']);
  // With a style: only the requested values (the omitted spacing is left to Ichitaro), the priority and the shared base.
  const styledVariant = styled.recipe.samples.find(item => item.id === 'br2-left24');
  const { layoutPriority, ...settings } = style;
  assert.deepEqual([styledVariant.settings, styledVariant.layoutPriority, styledVariant.features], [settings, 'counts', COLUMN_BASE_FEATURES]);
  assert.deepEqual(styled.capabilities.sort(), ['document-style', 'keisen-table']);
  // The table operations are the same either way.
  assert.deepEqual(styledVariant.keisenOperations, plainVariant.keisenOperations);
  assert.deepEqual(styled.recipe.text, plain.recipe.text);
  assert.deepEqual(styled.recipe.keisenCanvas, plain.recipe.keisenCanvas);
});

test('CR-008: the macro sets the document style before it draws the table, and only the requested values', () => {
  const job = compile({ ...table, style });
  const plan = expandExperiment(job.recipe);
  const spec = plan.samples.find(item => item.id === 'br2-left24');
  const explicit = job.recipe.samples.find(item => item.id === 'br2-left24').settings;
  const settings = Object.fromEntries(Object.keys(explicit).map(key => [key, spec.settings[key]]));
  const root = path.resolve('cr008-macro');
  const source = compileSample({ nonce: '12345678-1234-1234-1234-123456789abc', output: path.join(root, 'document.jtd'), resultPath: path.join(root, 'result.txt'), bodyPath: path.join(root, 'body.txt'), donePath: path.join(root, 'done.txt'),
    text: plan.text, settings, layoutPriority: spec.layoutPriority, features: spec.features, keisenCanvas: plan.keisenCanvas, keisenOperations: spec.keisenOperations });
  // DocumentStyleMargin takes top, bottom, left, right.
  const margin = source.indexOf('DocumentStyleMargin(30,30,24,30)'), firstRule = source.search(/Keisen(Mode|Start|\()/);
  assert.ok(margin > 0 && firstRule > 0 && margin < firstRule, 'DocumentStyleMargin before the first rule');
  assert.ok(source.indexOf('DocumentStyleFont(') < margin, 'the base font before the style');
  assert.match(source.slice(0, firstRule), /DocumentStyleLayout\(40,40,,,,,1\)/); // counts with priority; spacing is not requested
});

test('CR-008: the canonical example validates and covers keisen-table with a style', async () => {
  const catalog = JSON.parse(await fs.readFile('examples/agent/34-keisen-table-style.json', 'utf8'));
  const result = validateCatalog(catalog);
  assert.ok(result.capabilities.includes('keisen-table') && result.capabilities.includes('document-style'));
  assert.ok(catalog.samples.some(item => item.document.kind === 'keisen-table' && item.document.style) && catalog.samples.some(item => item.document.kind === 'keisen-table' && !item.document.style));
});
