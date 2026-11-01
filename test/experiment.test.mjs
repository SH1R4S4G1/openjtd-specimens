import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ExperimentValidationError,
  expandExperiment,
  loadExperiment,
  summarizeExperiment,
  validateExperiment,
} from '../src/experiment.mjs';

function source(overrides = {}) {
  return {
    schemaVersion: 1,
    name: 'style-experiment',
    text: 'Synthetic sample\n2nd line\r3rd line\r\n4th line',
    defaults: {
      chars: 40,
      lines: 40,
      characterSpacing: 1,
      lineSpacing: 60,
      marginTop: 30,
      marginBottom: 30,
      marginLeft: 30,
      marginRight: 30,
    },
    ...overrides,
  };
}

function invalid(input, expected = undefined, options = undefined) {
  assert.throws(() => expandExperiment(input, options), (error) => {
    assert.ok(error instanceof ExperimentValidationError);
    assert.equal(error.code, 'ERR_EXPERIMENT_INVALID');
    if (expected) assert.match(error.message, expected);
    return true;
  });
}

test('baseline uses explicit defaults and normalizes every newline to CRLF without mutating input', () => {
  const input = source();
  const original = structuredClone(input);
  const plan = expandExperiment(input);
  assert.equal(plan.text, 'Synthetic sample\r\n2nd line\r\n3rd line\r\n4th line');
  assert.deepEqual(plan.samples, [{ id: 'baseline', settings: input.defaults, changedFields: [] }]);
  assert.deepEqual(input, original);
  plan.samples[0].settings.chars = 1;
  assert.equal(plan.defaults.chars, 40);
  assert.equal(input.defaults.chars, 40);
});

test('each named sample starts from defaults instead of inheriting the prior sample', () => {
  const input = source({ samples: [
    { id: 'chars-41', settings: { chars: 41 } },
    { id: 'lines-42', settings: { lines: 42, marginTop: 30 } },
  ] });
  const plan = expandExperiment(input);
  assert.equal(plan.samples.length, 3);
  assert.equal(plan.samples[1].settings.chars, 41);
  assert.equal(plan.samples[2].settings.chars, 40);
  assert.equal(plan.samples[2].settings.lines, 42);
  assert.deepEqual(plan.samples[1].changedFields, ['chars']);
  assert.deepEqual(plan.samples[2].changedFields, ['lines']);
  plan.samples[1].settings.marginLeft = 100;
  assert.equal(plan.samples[2].settings.marginLeft, 30);
});

test('named samples retain an explicit layout priority without adding it to legacy plans', () => {
  const input = source({ samples: [
    { id: 'keep-priority', settings: {}, layoutPriority: 'preserve' },
    { id: 'use-counts', settings: { chars: 39 }, layoutPriority: 'counts' },
    { id: 'use-spacing', settings: { characterSpacing: 2 }, layoutPriority: 'spacing' },
    { id: 'legacy', settings: { lines: 39 } },
  ] });
  const original = structuredClone(input);
  const validated = validateExperiment(input);
  assert.deepEqual(validated.samples.map(sample => sample.layoutPriority), ['preserve', 'counts', 'spacing', undefined]);
  assert.equal(Object.hasOwn(validated.samples[3], 'layoutPriority'), false);
  const plan = expandExperiment(input);
  assert.equal(Object.hasOwn(plan.samples[0], 'layoutPriority'), false);
  assert.deepEqual(plan.samples.slice(1, 4).map(sample => sample.layoutPriority), ['preserve', 'counts', 'spacing']);
  assert.equal(Object.hasOwn(plan.samples[4], 'layoutPriority'), false);
  assert.deepEqual(plan.samples[3].changedFields, ['characterSpacing']);
  assert.deepEqual(input, original);
  const sweep = expandExperiment(source({ sweep: { field: 'chars', values: [39] } }));
  assert.ok(sweep.samples.every(sample => !Object.hasOwn(sample, 'layoutPriority')));
});

test('layout priority accepts only its exact enums on named samples', () => {
  for (const layoutPriority of [undefined, null, 1, true, '', 'Counts', 'automatic', {}, []]) {
    invalid(source({ samples: [{ id: 'bad-priority', settings: {}, layoutPriority }] }), /layoutPriority.*preserve, counts, spacing/);
  }
  invalid(source({ layoutPriority: 'spacing' }), /unrecognized property layoutPriority/);
  invalid(source({ sweep: { field: 'chars', values: [39], layoutPriority: 'counts' } }), /unrecognized property layoutPriority/);
  invalid(source({ samples: [{ id: 'bad-setting', settings: { layoutPriority: 'counts' } }] }), /unrecognized property layoutPriority/);
  let reads = 0;
  const sample = { id: 'accessor', settings: {} };
  Object.defineProperty(sample, 'layoutPriority', { enumerable: true, get() { reads++; return 'spacing'; } });
  invalid(source({ samples: [sample] }), /must be a data property/);
  assert.equal(reads, 0);
});

test('sweep plans have deterministic safe IDs and independent requested values', () => {
  const plan = expandExperiment(source({
    sweep: { field: 'characterSpacing', values: [-0.5, 0, 1, 1.5] },
  }));
  assert.deepEqual(plan.samples.map((sample) => sample.id), [
    'baseline', 'character-spacing-minus-0p5', 'character-spacing-0',
    'character-spacing-1', 'character-spacing-1p5',
  ]);
  assert.deepEqual(plan.samples.map((sample) => sample.changedFields), [
    [], ['characterSpacing'], ['characterSpacing'], [], ['characterSpacing'],
  ]);
  assert.equal(plan.samples[4].settings.lineSpacing, 60);
  assert.deepEqual(summarizeExperiment(plan), {
    name: 'style-experiment', sampleCount: 5, textLength: plan.text.length,
    changedFields: ['characterSpacing'], baselineIncluded: true,
  });
});

test('sweep can explicitly omit the baseline, including under a one-sample limit', () => {
  const plan = expandExperiment(source({
    sweep: { field: 'chars', values: [41], includeBaseline: false },
  }), { maxSamples: 1 });
  assert.equal(plan.samples.length, 1);
  assert.equal(plan.samples[0].id, 'chars-41');
  assert.equal(summarizeExperiment(plan).baselineIncluded, false);
});

test('requires explicit schema and all defaults, rejects unknown fields at every level', () => {
  const noVersion = source();
  delete noVersion.schemaVersion;
  invalid(noVersion, /schemaVersion/);
  const missingDefault = source();
  delete missingDefault.defaults.marginRight;
  invalid(missingDefault, /defaults.marginRight.*required/);
  invalid(source({ unexpected: true }), /unrecognized property unexpected/);
  invalid(source({ defaults: { ...source().defaults, font: 'x' } }), /unrecognized property font/);
  invalid(source({ samples: [{ id: 'x', settings: {}, unknown: 1 }] }), /unrecognized property unknown/);
  invalid(source({ samples: [{ id: 'x', settings: { unknown: 1 } }] }), /unrecognized property unknown/);
  invalid(source({ sweep: { field: 'chars', values: [41], extra: 1 } }), /unrecognized property extra/);
  invalid(source({ samples: [], sweep: { field: 'chars', values: [41] } }), /mutually exclusive/);
});

test('unsafe and reserved names cannot become experiment or sample paths', () => {
  for (const name of ['../escape', 'a/b', 'a\\b', '.', '..', 'a.', 'a ', '日本語', 'C:drive', 'CON', 'nul', 'LPT9', 'COM1', '']) {
    invalid(source({ name }), /experiment.name/);
    invalid(source({ samples: [{ id: name, settings: {} }] }), /\.id/);
  }
  invalid(source({ samples: [{ id: 'Baseline', settings: {} }] }), /baseline is reserved/);
  invalid(source({ samples: [{ id: 'Case', settings: {} }, { id: 'case', settings: {} }] }), /unique ignoring case/);
});

test('rejects malformed sample and sweep structures, including duplicate values', () => {
  for (const samples of [null, {}, true, 1]) invalid(source({ samples }), /samples/);
  invalid(source({ samples: Array(1) }), /samples\[0\]/);
  invalid(source({ sweep: { field: 'chars', values: Array(1) } }), /values\[0\]/);
  for (const sample of [null, [], 'x', { id: 'x' }, { id: 'x', settings: null }]) {
    invalid(source({ samples: [sample] }));
  }
  for (const sweep of [null, [], {}, { field: 'font', values: [1] }, { field: 'chars', values: [] },
    { field: 'chars', values: [1, 1] }, { field: 'characterSpacing', values: [0, -0] },
    { field: 'chars', values: [1], includeBaseline: 'yes' }]) {
    invalid(source({ sweep }));
  }
});

test('accepts decimal character counts but requires integral line counts', () => {
  const plan = expandExperiment(source({ samples: [{ id: 'half-character', settings: { chars: 40.5 } }] }));
  assert.equal(plan.samples[1].settings.chars, 40.5);
  invalid(source({ samples: [{ id: 'half-line', settings: { lines: 40.5 } }] }), /settings.lines/);
});

test('rejects NaN, infinity, numeric strings and unbounded values', () => {
  for (const value of [NaN, Infinity, -Infinity, '40', null, 0, -1, 10001]) {
    invalid(source({ samples: [{ id: 'bad', settings: { chars: value } }] }), /settings.chars/);
  }
  for (const value of [NaN, Infinity, -Infinity, '1', null, -10001, 10001]) {
    invalid(source({ samples: [{ id: 'bad', settings: { characterSpacing: value } }] }), /settings.characterSpacing/);
  }
  invalid(source({ text: 'bad\0text' }), /NUL/);
  invalid(source({ text: 1 }), /must be a string/);
});

test('sample count includes baseline, with explicit opt-in up to the hard ceiling', () => {
  const input = source({ sweep: { field: 'chars', values: Array.from({ length: 200 }, (_, i) => i + 1) } });
  invalid(input, /201 samples/);
  assert.equal(expandExperiment(input, { maxSamples: 201 }).samples.length, 201);
  const ceiling = source({ sweep: { field: 'chars', values: Array.from({ length: 1000 }, (_, i) => i + 1) } });
  invalid(ceiling, /1001 samples/, { maxSamples: 1000 });
  for (const maxSamples of [0, 1001, 1.1, '200', NaN]) invalid(source(), /options.maxSamples/, { maxSamples });
  invalid(source(), /unrecognized property limit/, { limit: 100 });
});

test('rejects prototype fields and accessors without executing them', () => {
  const poisoned = JSON.parse(JSON.stringify(source()).replace('"schemaVersion":1', '"schemaVersion":1,"__proto__":{}'));
  invalid(poisoned, /unrecognized property __proto__/);
  let called = false;
  const withGetter = source();
  Object.defineProperty(withGetter, 'name', { get() { called = true; return 'hidden'; } });
  invalid(withGetter, /must be a data property/);
  assert.equal(called, false);
});

test('validation returns a normalized copy while loading UTF-8 BOM JSON produces a plan', async () => {
  const input = source({ sweep: { field: 'marginLeft', values: [31] } });
  const validated = validateExperiment(input);
  assert.equal(validated.sweep.includeBaseline, true);
  assert.notEqual(validated.defaults, input.defaults);
  const directory = await mkdtemp(join(tmpdir(), 'openjtd-specimens-experiment-'));
  try {
    const path = join(directory, 'experiment.json');
    await writeFile(path, '\uFEFF' + JSON.stringify(input), 'utf8');
    assert.deepEqual(await loadExperiment(path), expandExperiment(input));
    await writeFile(path, '{"schemaVersion":', 'utf8');
    await assert.rejects(loadExperiment(path), { code: 'ERR_EXPERIMENT_INVALID' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
