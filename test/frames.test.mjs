import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFrames, framesMacro, verifyFrames, FRAME_TOLERANCE_MM } from '../src/frames.mjs';
import { macroString } from '../src/adapters/macro.mjs';
import { expandExperiment } from '../src/experiment.mjs';

const text = '本文の第一段落\n本文の第二段落';
const frame = { name: 'frame-a', left: 50, top: 100, width: 60, height: 30, text: '枠内の文字' };

// Synthetic getter readback in the same key layout the macro prints.
function readback(frames, overrides = {}) {
  const meta = {};
  for (const stage of ['before-save', 'reopened']) {
    for (const [i, f] of frames.entries()) {
      const base = `frame.${stage}.${i}.`;
      const position = [1, f.left - 1.25, f.top + 0.5, f.width, f.height + 1];
      Object.assign(meta, { [base + 'name']: f.name, [base + 'id']: String(i + 1), [base + 'lines']: '1', [base + 'text.1']: f.text,
        [base + 'alignment.0']: '1', [base + 'alignment.1']: '1', [base + 'decoration.0']: String(f.border ?? 0), [base + 'decoration.1']: '0' });
      position.forEach((v, n) => { meta[base + 'position.' + n] = String(v); });
      ['14.5', '4', '1', '60', '100', String(f.writingMode ?? 1), '0'].forEach((v, n) => { meta[base + 'layout.' + n] = v; });
    }
    text.split('\n').forEach((line, p) => Array.from(line).forEach((c, k) => { meta[`frame.${stage}.body.${p}.${k}`] = c; }));
  }
  return Object.assign(meta, overrides);
}

test('frame recipes validate names, page bounds, gaps and whitespace-free bodies', () => {
  assert.deepEqual(validateFrames([frame], text)[0], { ...frame, writingMode: 1, border: 0 });
  assert.throws(() => validateFrames([], text), /1..3 frames/);
  assert.throws(() => validateFrames([frame, { ...frame }], text), /unique/);
  assert.throws(() => validateFrames([{ ...frame, left: 150, width: 60 }], text), /stay on the A4/);
  assert.throws(() => validateFrames([frame, { ...frame, name: 'b', left: 112 }], text), /overlap/);
  assert.equal(validateFrames([frame, { ...frame, name: 'b', left: 117 }], text).length, 2);
  assert.throws(() => validateFrames([{ ...frame, text: '枠 内' }], text), /frame text/);
  assert.throws(() => validateFrames([frame], '本文 の段落'), /non-whitespace/);
  assert.throws(() => validateFrames([{ ...frame, extra: 1 }], text), /unknown frame field/);
});

test('frame macro creates, names and reads frames by name without arbitrary statements', () => {
  const { apply, snapshot } = framesMacro({ text, frames: [{ ...frame, writingMode: 2, border: 1 }], q: macroString });
  assert.ok(apply.includes('LayoutboxCreateMode(20,1,2)'));
  assert.ok(apply.includes('LayoutboxStart(1,50,100)') && apply.includes('LayoutboxEnd(110,130)'));
  assert.ok(apply.indexOf('LayoutboxEditMode(2)') < apply.indexOf('SelectFrame()'));
  assert.ok(snapshot('reopened').some(line => line.startsWith('SelectFrameName(')));
});

test('frame verification asserts tolerance, reopen identity and body characters', () => {
  const frames = [frame];
  let result = verifyFrames(readback(frames), { text, frames });
  assert.equal(result.proof.passed, true);
  assert.deepEqual(result.proof.checks[0].snapMm, { left: -1.25, top: 0.5, width: 0, height: 1 });
  result = verifyFrames(readback(frames, { 'frame.before-save.0.position.1': String(frame.left - FRAME_TOLERANCE_MM - 0.5), 'frame.reopened.0.position.1': String(frame.left - FRAME_TOLERANCE_MM - 0.5) }), { text, frames });
  assert.ok(result.differences.some(d => d.field === 'left' && d.phase === 'before-save'));
  result = verifyFrames(readback(frames, { 'frame.reopened.0.position.2': '100.4' }), { text, frames });
  assert.ok(result.differences.some(d => d.phase === 'reopened' && d.field === 'position'));
  assert.equal(result.proof.reopened, false);
  result = verifyFrames(readback(frames, { 'frame.reopened.body.1.2': '他' }), { text, frames });
  assert.ok(result.differences.some(d => d.field === 'body.1'));
  result = verifyFrames(readback(frames, { 'frame.before-save.0.decoration.0': '1' }), { text, frames });
  assert.ok(result.differences.some(d => d.field === 'border'));
  assert.throws(() => verifyFrames({}, { text, frames }), /Missing frame readback/);
});

test('frame trials combine only with listed elements and accept font and paper overrides', () => {
  const recipe = { schemaVersion: 1, name: 'frames', text, defaults: { chars: 40, lines: 40, characterSpacing: 1, lineSpacing: 60, marginTop: 30, marginBottom: 30, marginLeft: 30, marginRight: 30 },
    samples: [{ id: 'one', settings: {}, frames: [frame] }] };
  const plan = expandExperiment(recipe);
  assert.equal(plan.samples[0].frames, undefined);
  assert.equal(plan.samples[1].frames[0].name, 'frame-a');
  assert.equal(plan.samples[1].layoutPriority, 'counts');
  assert.throws(() => expandExperiment({ ...recipe, samples: [{ id: 'one', settings: {}, frames: [frame], namedStyle: { kind: 'character', steps: [] } }] }), /cannot combine|Named style/);
  const custom = expandExperiment({ ...recipe, samples: [{ id: 'one', settings: { chars: 30 }, frames: [frame], features: { font: { size: 12 }, paper: { name: 'B5 単票・縦方向' } } }] }).samples[1];
  assert.deepEqual([custom.settings.chars, custom.features.font.size, custom.features.font.japaneseName, custom.features.paper.name, custom.features.layout.orientation], [30, 12, '游明朝', 'B5 単票・縦方向', 1]);
  assert.throws(() => expandExperiment({ ...recipe, samples: [{ id: 'one', settings: {}, frames: [frame], features: { layout: { orientation: 2 } } }] }), /font, paper, column-format, page-number and typesetting overrides only/);
});
