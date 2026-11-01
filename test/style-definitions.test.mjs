import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStyleDefinitions, styleDefinitionsMacro, verifyStyleDefinitions } from '../src/style-definitions.mjs';
import { macroString } from '../src/adapters/macro.mjs';

const text = '甲乙\n丙丁';
const trial = { definitions: [{ kind: 'paragraph', name: 'Midashi', sizePt: 14 }, { kind: 'character', name: 'Unused', sizePt: 9 }], applications: [{ paragraph: 1, style: 'Midashi' }] };

function readback({ point = {}, direct = {}, registry = {} } = {}) {
  const meta = {};
  for (const stage of ['initial', 'before-save', 'reopened']) {
    const b = `styles.${stage}.`;
    const lists = stage === 'initial' ? { character: ['既存'], paragraph: [] } : { character: ['既存', 'Unused'], paragraph: ['Midashi'], ...registry };
    for (const kind of ['character', 'paragraph']) { meta[b + kind + 'Count'] = String(lists[kind].length); lists[kind].forEach((v, i) => { meta[`${b}${kind}.${i + 1}`] = v; }); }
    text.split('\n').forEach((line, p) => Array.from(line).forEach((c, k) => {
      const styled = stage !== 'initial' && p === 1;
      Object.assign(meta, { [`${b}${p}.${k}.char`]: c, [`${b}${p}.${k}.point`]: point[stage] ?? (styled ? '14' : '12'), [`${b}${p}.${k}.direct`]: direct[stage] ?? '10.5', [`${b}${p}.${k}.paragraphStyle`]: styled ? 'Midashi' : '' });
    }));
  }
  return meta;
}

test('style definitions validate names, sizes and one style per paragraph', () => {
  assert.equal(validateStyleDefinitions(trial, text).applications[0].style, 'Midashi');
  for (const bad of [{ definitions: [] }, { definitions: [{ kind: 'x', name: 'A', sizePt: 10 }] }, { definitions: [{ kind: 'paragraph', name: '見出し', sizePt: 10 }] },
    { definitions: [{ kind: 'paragraph', name: 'A', sizePt: 10.25 }] }, { definitions: [{ kind: 'paragraph', name: 'A', sizePt: 10 }], applications: [{ paragraph: 0, style: 'B' }] },
    { definitions: [{ kind: 'paragraph', name: 'A', sizePt: 10 }], applications: [{ paragraph: 0, style: 'A' }, { paragraph: 0, style: 'A' }] }])
    assert.throws(() => validateStyleDefinitions(bad, text));
});

test('style macro defines locally and applies to whole paragraphs', () => {
  const { apply } = styleDefinitionsMacro({ text, trial, q: macroString });
  assert.ok(apply.some(l => l.startsWith('EntryParagraphStyle(')) && apply.some(l => l.startsWith('SetParagraphStyle(1,')));
  assert.ok(!apply.some(l => /Record|System/.test(l)));
});

test('style verification uses effective size, unchanged attribute size and registry sets', () => {
  assert.equal(verifyStyleDefinitions(readback(), { text, trial, baseSize: 12 }).proof.passed, true);
  assert.equal(verifyStyleDefinitions(readback({ point: { reopened: '12' } }), { text, trial, baseSize: 12 }).proof.reopened, false);
  assert.equal(verifyStyleDefinitions(readback({ direct: { 'before-save': '14' } }), { text, trial, baseSize: 12 }).proof.passed, false);
  assert.equal(verifyStyleDefinitions(readback({ registry: { paragraph: [] } }), { text, trial, baseSize: 12 }).proof.passed, false);
  const existing = readback(); existing['styles.initial.paragraphCount'] = '1'; existing['styles.initial.paragraph.1'] = 'Midashi';
  assert.throws(() => verifyStyleDefinitions(existing, { text, trial, baseSize: 12 }), /already exists/);
});
