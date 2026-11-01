import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHeaderLayout, headerLayoutMacro, verifyHeaderLayout } from '../src/header-layout.mjs';
import { macroString } from '../src/adapters/macro.mjs';
import { compileCatalog } from '../src/sample-catalog.mjs';

const text = '一ページ目\n二ページ目';

function readback(layout, overrides = {}) {
  const meta = {};
  const slots = s => [s.left ?? '', s.center ?? '', s.right ?? ''];
  for (const stage of ['before-save', 'reopened']) {
    const base = `headerLayout.${stage}.`;
    Object.assign(meta, { [base + 'oddEven']: layout.even ? '1' : '0', [base + 'distribution']: '0', [base + 'bodyArea']: '1', [base + 'bodyLines']: '2', [base + 'body.1']: '一ページ目', [base + 'body.2']: '二ページ目' });
    for (let p = 1; p <= 4; p++) ['1', '20', '1', ...slots(layout.odd)].forEach((v, n) => { meta[`${base}each.${p}.${n}`] = p === layout.position ? v : ['0', '20', '1', '', '', ''][n]; });
    const pages = layout.even ? [layout.odd, layout.even] : [layout.odd];
    pages.forEach((s, i) => Object.assign(meta, { [`${base}page.${i + 1}.area`]: String(layout.position + 3), [`${base}page.${i + 1}.number`]: String(i + 1), [`${base}page.${i + 1}.lines`]: '1', [`${base}page.${i + 1}.text.1`]: slots(s).filter(Boolean).join(' ') }));
  }
  return Object.assign(meta, overrides);
}

test('header layout validation requires slots, short strings and two pages for even pages', () => {
  assert.deepEqual(validateHeaderLayout({ position: 1, odd: { right: '右', left: '左' } }, text), { position: 1, odd: { left: '左', right: '右' } });
  assert.throws(() => validateHeaderLayout({ position: 3, odd: { left: '左' } }, text), /position/);
  assert.throws(() => validateHeaderLayout({ position: 1, odd: {} }, text), /left\/center\/right/);
  assert.throws(() => validateHeaderLayout({ position: 1, odd: { left: '左 側' } }, text), /left\/center\/right/);
  assert.throws(() => validateHeaderLayout({ position: 1, odd: { left: '左' }, even: { right: '右' } }, '一\n二\n三'), /exactly 2 paragraphs/);
});

test('header layout macro sets odd/even positions explicitly', () => {
  const { apply } = headerLayoutMacro({ text, layout: { position: 2, odd: { left: '奇' }, even: { right: '偶' } }, q: macroString });
  assert.ok(apply.includes('HeaderFooterArrangement(0,1)'));
  assert.ok(apply.some(line => line.startsWith('HeaderFooterEach(7,1,20,1,')) && apply.some(line => line.startsWith('HeaderFooterEach(8,1,20,1,')));
});

test('header layout verification checks slots, page strings and other positions', () => {
  const layout = { position: 1, odd: { left: '奇数頁' }, even: { right: '偶数頁' } };
  assert.equal(verifyHeaderLayout(readback(layout), { text, layout }).proof.passed, true);
  for (const [key, value] of [['headerLayout.reopened.each.1.4', '奇数頁'], ['headerLayout.before-save.page.2.text.1', '別'], ['headerLayout.reopened.oddEven', '0'], ['headerLayout.before-save.each.2.0', '1'], ['headerLayout.reopened.body.2', '別']]) {
    assert.equal(verifyHeaderLayout(readback(layout, { [key]: value }), { text, layout }).proof.passed, false, key);
  }
});

test('public headerFooter slots compile to the header layout trial and stay isolated', () => {
  const sample = { id: 's', title: 't', purpose: 'p', feature: 'header-layout', expected: [{ property: 'x', value: 1 }], document: { kind: 'paragraphs', text, headerFooter: { position: 'footer', center: '中央', evenPages: { text: '偶' } } } };
  const job = compileCatalog({ schemaVersion: 1, id: 'c', samples: [sample] }).jobs[0];
  assert.deepEqual(job.recipe.samples[0].headerLayout, { position: 2, odd: { center: '中央' }, even: { left: '偶' } });
  sample.document = { ...sample.document, frames: [{ name: 'f', left: 50, top: 100, width: 60, height: 30, text: '枠' }] };
  assert.throws(() => compileCatalog({ schemaVersion: 1, id: 'c', samples: [sample] }), /cannot combine/);
});
