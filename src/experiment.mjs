import { validateFootnote } from './footnotes.mjs';
import { validateNamedStyle } from './named-styles.mjs';
import { validateHeaderPages } from './header-pages.mjs';
import { validateHeaderSteps, validateHeaderPosition } from './headers.mjs';
import { validateDocumentColumns, validateColumnRange, COLUMN_BASE_FEATURES } from './document-columns.mjs';
import { validateFrames } from './frames.mjs';
import { validateHeaderLayout } from './header-layout.mjs';
import { validateStyleDefinitions } from './style-definitions.mjs';
import { readFile } from 'node:fs/promises';
import { validateFeatures } from './features.mjs';
import { bodyParagraphs } from './body-paragraphs.mjs';
const STRUCTURAL_FIELDS = ['footnote','namedStyle','headerSteps','documentColumns','frames','headerLayout','namedStyles','columnRange'];
import { validateTargets, validateOperations } from './ranges.mjs';
import { validateKeisenCanvas, validateKeisenOperations } from './keisen.mjs';
import { validateParagraphTargets, validateParagraphOperations } from './paragraphs.mjs';

/** The supported document-style inputs, in the order used in plans and reports. */
export const STYLE_FIELDS = Object.freeze([
  'chars',
  'lines',
  'characterSpacing',
  'lineSpacing',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
]);

export const DEFAULT_MAX_SAMPLES = 200;
export const HARD_MAX_SAMPLES = 1000;

const FIELD_SET = new Set(STYLE_FIELDS);
const ROOT_FIELDS = new Set(['schemaVersion', 'name', 'text', 'defaults', 'styleSource', 'bodyCheck', 'samples', 'sweep', 'targets','keisenCanvas','paragraphTargets']);
// CR-001: a recipe may leave the document style exactly as Ichitaro creates a new
// document. No defaults, no numeric settings and no fixed features are then
// applied to the baseline or to any sample, so no document style setter runs.
export const STYLE_SOURCES = new Set(['new-document']);
const NEW_DOCUMENT_SAMPLE_FIELDS = new Set(['id', 'settings', 'operations']);
export const SAMPLE_FIELDS = new Set(['id', 'settings', 'layoutPriority', 'features', 'operations','keisenOperations','paragraphOperations','documentColumns','headerSteps','headerPosition','headerPages','namedStyle','footnote','frames','headerLayout','namedStyles','columnRange']);
const LAYOUT_PRIORITIES = new Set(['preserve', 'counts', 'spacing']);
const SWEEP_FIELDS = new Set(['field', 'values', 'includeBaseline']);
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const SLUG = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

export class ExperimentValidationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'ExperimentValidationError';
    this.code = 'ERR_EXPERIMENT_INVALID';
    this.path = path;
  }
}

function fail(path, message) {
  throw new ExperimentValidationError(path, message);
}

function record(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, 'must be a plain object');
  }
  return value;
}

function knownKeys(value, allowed, path) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      fail(path, `unrecognized property ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) {
      fail(`${path}.${key}`, 'must be a data property');
    }
  }
}

function slug(value, path) {
  if (typeof value !== 'string' || !SLUG.test(value)) {
    fail(path, 'must be 1–80 ASCII letters, digits, underscores or hyphens, starting with a letter or digit');
  }
  if (WINDOWS_RESERVED.test(value)) {
    fail(path, 'must not be a reserved Windows device name');
  }
  return value;
}

function numericValue(value, field, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'must be a finite number');
  }
  // These are planning guardrails, not a claim about Ichitaro's accepted ranges.
  // The application adapter must still validate the value and record readback.
  if (field === 'lines') {
    if (!Number.isInteger(value) || value < 1 || value > 10000) fail(path, 'must be an integer between 1 and 10000');
  } else if (field === 'chars') {
    if (value < 1 || value > 10000) fail(path, 'must be between 1 and 10000; decimal character counts are supported');
  } else if (value < -10000 || value > 10000) {
    fail(path, 'must be between -10000 and 10000; the application determines its actual range');
  }
  return Object.is(value, -0) ? 0 : value;
}

function style(value, path, requireAll) {
  record(value, path);
  knownKeys(value, FIELD_SET, path);
  const result = {};
  for (const field of STYLE_FIELDS) {
    if (!Object.hasOwn(value, field)) {
      if (requireAll) fail(`${path}.${field}`, 'is required; defaults must be explicit');
      continue;
    }
    result[field] = numericValue(value[field], field, `${path}.${field}`);
  }
  return result;
}

function sampleLimit(options) {
  record(options, 'options');
  knownKeys(options, new Set(['maxSamples']), 'options');
  const limit = Object.hasOwn(options, 'maxSamples') ? options.maxSamples : DEFAULT_MAX_SAMPLES;
  if (!Number.isInteger(limit) || limit < 1 || limit > HARD_MAX_SAMPLES) {
    fail('options.maxSamples', `must be an integer between 1 and ${HARD_MAX_SAMPLES}`);
  }
  return limit;
}

/**
 * Validate and copy a schema-v1 source experiment, normalizing text to CRLF.
 * All eight defaults are mandatory. An explicit sample list gets an automatic
 * baseline; a sweep can omit it with includeBaseline:false. Counts include it.
 * This validates requested inputs, not values accepted by the installed app.
 */
export function validateExperiment(input, options = {}) {
  const maxSamples = sampleLimit(options);
  record(input, 'experiment');
  knownKeys(input, ROOT_FIELDS, 'experiment');
  if (input.schemaVersion !== 1) fail('experiment.schemaVersion', 'must be 1');
  const name = slug(input.name, 'experiment.name');
  if (typeof input.text !== 'string') fail('experiment.text', 'must be a string');
  if (input.text.includes('\0')) fail('experiment.text', 'must not contain NUL characters');
  const text = input.text.replace(/\r\n|\r|\n/g, '\r\n');
  const styleSource = Object.hasOwn(input, 'styleSource') ? input.styleSource : null;
  if (styleSource !== null) {
    if (!STYLE_SOURCES.has(styleSource)) fail('experiment.styleSource', 'must be new-document');
    if (Object.hasOwn(input, 'defaults')) fail('experiment.defaults', 'must be omitted with styleSource; the new document supplies the style');
    if (Object.hasOwn(input, 'sweep')) fail('experiment.sweep', 'cannot combine with styleSource');
    if (Object.hasOwn(input, 'keisenCanvas') || Object.hasOwn(input, 'paragraphTargets')) fail('experiment.styleSource', 'combines with text targets only');
  }
  const defaults = styleSource ? {} : style(input.defaults, 'experiment.defaults', true);
  const result = { schemaVersion: 1, name, text, defaults, ...(styleSource ? { styleSource } : {}) };
  // CR-003: a long plain body is proven by joined lines and a paragraph walk
  // instead of the per-character range walk (src/body-paragraphs.mjs).
  if (Object.hasOwn(input, 'bodyCheck')) {
    if (input.bodyCheck !== 'paragraph-ends') fail('experiment.bodyCheck', 'must be paragraph-ends');
    if (['keisenCanvas', 'paragraphTargets', 'sweep'].some(key => Object.hasOwn(input, key))) fail('experiment.bodyCheck', 'combines with plain text and text targets only');
    try { bodyParagraphs(text); } catch (error) { fail('experiment.text', error.message); }
    result.bodyCheck = input.bodyCheck;
  }
  if(Object.hasOwn(input,'targets'))result.targets=validateTargets(input.targets,text);
  if(Object.hasOwn(input,'keisenCanvas')){if(result.targets)fail('keisenCanvas','cannot combine with text targets yet');result.keisenCanvas=validateKeisenCanvas(input.keisenCanvas,text);}
  if(Object.hasOwn(input,'paragraphTargets')){if(result.targets||result.keisenCanvas)fail('paragraphTargets','cannot combine with character or table operations');result.paragraphTargets=validateParagraphTargets(input.paragraphTargets,text);}
  const hasSamples = Object.hasOwn(input, 'samples');
  const hasSweep = Object.hasOwn(input, 'sweep');
  if (hasSamples && hasSweep) fail('experiment', 'samples and sweep are mutually exclusive');
  let count = 1;

  if (hasSamples) {
    if (!Array.isArray(input.samples)) fail('experiment.samples', 'must be an array');
    if (input.samples.length + 1 > maxSamples) {
      fail('experiment', `expands to ${input.samples.length + 1} samples, exceeding maxSamples ${maxSamples} (hard limit ${HARD_MAX_SAMPLES})`);
    }
    const seen = new Set(['baseline']);
    result.samples = Array.from(input.samples, (sample, index) => {
      const path = `experiment.samples[${index}]`;
      record(sample, path);
      knownKeys(sample, SAMPLE_FIELDS, path);
      const id = slug(sample.id, `${path}.id`);
      const normalizedId = id.toLowerCase();
      if (seen.has(normalizedId)) {
        fail(`${path}.id`, 'must be unique ignoring case; baseline is reserved for the automatic baseline');
      }
      seen.add(normalizedId);
      if (styleSource) {
        for (const key of Object.keys(sample)) if (!NEW_DOCUMENT_SAMPLE_FIELDS.has(key)) fail(`${path}.${key}`, 'cannot combine with styleSource');
        if (Object.keys(sample.settings ?? {}).length) fail(`${path}.settings`, 'must be empty with styleSource');
      }
      const normalized = { id, settings: style(sample.settings, `${path}.settings`, false) };
      if(Object.hasOwn(sample,'footnote'))normalized.footnote=validateFootnote(sample.footnote,text);
      if(Object.hasOwn(sample,'namedStyle'))normalized.namedStyle=validateNamedStyle(sample.namedStyle,text);
      if(Object.hasOwn(sample,'headerPages')){if(!Object.hasOwn(sample,'headerSteps'))fail('headerPages','requires headerSteps');normalized.headerPages=validateHeaderPages(sample.headerPages);}
      if(Object.hasOwn(sample,'headerPosition')){if(!Object.hasOwn(sample,'headerSteps'))fail('headerPosition','requires headerSteps');normalized.headerPosition=validateHeaderPosition(sample.headerPosition);}
      if(Object.hasOwn(sample,'headerSteps'))normalized.headerSteps=validateHeaderSteps(sample.headerSteps,text);
      if(Object.hasOwn(sample,'documentColumns'))normalized.documentColumns=validateDocumentColumns(sample.documentColumns,text);
      if(Object.hasOwn(sample,'columnRange'))normalized.columnRange=validateColumnRange(sample.columnRange,sample.documentColumns,text);
      if(Object.hasOwn(sample,'frames'))normalized.frames=validateFrames(sample.frames,text);
      if(Object.hasOwn(sample,'namedStyles'))normalized.namedStyles=validateStyleDefinitions(sample.namedStyles,text);
      if(Object.hasOwn(sample,'headerLayout'))normalized.headerLayout=validateHeaderLayout(sample.headerLayout,text);
      if(Object.hasOwn(sample,'operations'))normalized.operations=validateOperations(sample.operations,result.targets);
      if(Object.hasOwn(sample,'keisenOperations'))normalized.keisenOperations=validateKeisenOperations(sample.keisenOperations,result.keisenCanvas);
      if(Object.hasOwn(sample,'paragraphOperations')){if(!result.paragraphTargets)fail('paragraphOperations','paragraphTargets required');normalized.paragraphOperations=validateParagraphOperations(sample.paragraphOperations,result.paragraphTargets);}
      if(Object.hasOwn(sample,'features')) {
        try {normalized.features=validateFeatures(sample.features);}catch(error){fail(`${path}.features`,error.message);}
      }
      if (Object.hasOwn(sample, 'layoutPriority')) {
        if (!LAYOUT_PRIORITIES.has(sample.layoutPriority)) {
          fail(`${path}.layoutPriority`, 'must be one of preserve, counts, spacing');
        }
        normalized.layoutPriority = sample.layoutPriority;
      }
      return normalized;
    });
    count += result.samples.length;
  } else if (hasSweep) {
    const sweep = record(input.sweep, 'experiment.sweep');
    knownKeys(sweep, SWEEP_FIELDS, 'experiment.sweep');
    if (!FIELD_SET.has(sweep.field)) fail('experiment.sweep.field', `must be one of ${STYLE_FIELDS.join(', ')}`);
    if (!Array.isArray(sweep.values) || sweep.values.length === 0) {
      fail('experiment.sweep.values', 'must be a nonempty array');
    }
    const includeBaseline = Object.hasOwn(sweep, 'includeBaseline') ? sweep.includeBaseline : true;
    if (typeof includeBaseline !== 'boolean') fail('experiment.sweep.includeBaseline', 'must be a boolean');
    if (sweep.values.length + Number(includeBaseline) > maxSamples) {
      fail('experiment', `expands to ${sweep.values.length + Number(includeBaseline)} samples, exceeding maxSamples ${maxSamples} (hard limit ${HARD_MAX_SAMPLES})`);
    }
    const seen = new Set();
    const values = Array.from(sweep.values, (value, index) => {
      const path = `experiment.sweep.values[${index}]`;
      const normalizedValue = numericValue(value, sweep.field, path);
      if (seen.has(normalizedValue)) fail(path, 'must not duplicate another sweep value');
      seen.add(normalizedValue);
      return normalizedValue;
    });
    result.sweep = { field: sweep.field, values, includeBaseline };
    count = values.length + Number(includeBaseline);
  }

  if (count > maxSamples) {
    fail('experiment', `expands to ${count} samples, exceeding maxSamples ${maxSamples} (hard limit ${HARD_MAX_SAMPLES})`);
  }
  return result;
}

function expandedSample(id, overrides, defaults) {
  const settings = { ...defaults, ...overrides };
  const changedFields = STYLE_FIELDS.filter((field) => settings[field] !== defaults[field]);
  return { id, settings, changedFields };
}

function sweepId(field, value) {
  const fieldLabel = field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const valueLabel = String(value).replace(/^-/, 'minus-').replace(/\./g, 'p').replace(/\+/g, '');
  return `${fieldLabel}-${valueLabel}`;
}

/**
 * Produce the unified execution plan. Each sample requests a fresh copy of the
 * defaults plus its own overrides; no sample inherits a previous sample's edits.
 * changedFields describes requests only: coupled app settings require readback.
 */
export function expandExperiment(input, options = {}) {
  const validated = validateExperiment(input, options);
  const { schemaVersion, name, text, defaults, styleSource, bodyCheck } = validated;
  const samples = [];
  if (!validated.sweep || validated.sweep.includeBaseline) {
    samples.push(expandedSample('baseline', {}, defaults));
  }
  if (validated.sweep) {
    const { field, values } = validated.sweep;
    for (const value of values) {
      samples.push(expandedSample(sweepId(field, value), { [field]: value }, defaults));
    }
  } else if (validated.samples) {
    for (const sample of validated.samples) {
      const expanded = expandedSample(sample.id, sample.settings, defaults);
      if (Object.hasOwn(sample, 'layoutPriority')) expanded.layoutPriority = sample.layoutPriority;
      if (Object.hasOwn(sample, 'features')) expanded.features = sample.features;
      samples.push(expanded);
    }
  }
  if(validated.targets){
    for(let i=0;i<samples.length;i++){
      const original=validated.samples?.find(s=>s.id===samples[i].id);
      if(original?.operations)samples[i].operations=original.operations;
      if(samples[i].features?.layout?.orientation===2)fail('features.layout.orientation','range execution currently requires horizontal writing');
    }
  }
  if(validated.keisenCanvas)for(const s of samples){s.keisenOperations=validated.samples?.find(o=>o.id===s.id)?.keisenOperations??[];if(s.features?.layout?.orientation===2)fail('features.layout.orientation','keisen currently requires horizontal writing');}
  if(validated.paragraphTargets)for(const s of samples){s.paragraphOperations=validated.samples?.find(o=>o.id===s.id)?.paragraphOperations??[];if(s.features?.layout?.orientation===2)fail('features.layout.orientation','paragraph trials require horizontal writing');}
  // Structural elements share one horizontal base (COLUMN_BASE_FEATURES) that a
  // sample may override with font, paper, column format, page number and typesetting. Combinations are allowed only when
  // listed here and verified on the real application; others stay isolated.
  const STRUCTURAL=['footnote','namedStyle','headerSteps','documentColumns','frames','headerLayout','namedStyles'];
  const COMBINABLE={namedStyles:[],headerLayout:[],footnote:['headerSteps'],namedStyle:[],headerSteps:['footnote','documentColumns','frames','paragraph'],documentColumns:['headerSteps','frames','paragraph'],frames:['headerSteps','documentColumns','paragraph'],paragraph:['headerSteps','documentColumns','frames']};
  const structural=STRUCTURAL.filter(key=>validated.samples?.some(sample=>sample[key]!==undefined));
  if(structural.length){
    const present=[...structural,...(validated.paragraphTargets?['paragraph']:[]),...(validated.targets?['targets']:[]),...(validated.keisenCanvas?['keisenCanvas']:[])];
    for(const a of structural)for(const b of present)if(a!==b&&!COMBINABLE[a].includes(b))fail(a,`cannot combine with ${b}`);
    const first=key=>validated.samples.find(sample=>sample[key]!==undefined)?.[key];
    const headerPages=validated.samples.find(s=>s.headerSteps!==undefined)?.headerPages??1;
    const headerPosition=validated.samples.find(s=>s.headerSteps!==undefined)?.headerPosition??1;
    if(structural.includes('headerSteps')){
      if(validated.samples.some(s=>s.headerSteps!==undefined&&(s.headerPages??1)!==headerPages))fail('headerPages','all samples must use same page count');
      if(validated.samples.some(s=>s.headerSteps!==undefined&&(s.headerPosition??1)!==headerPosition))fail('headerPosition','all samples must use the same position');
      if(headerPages===3&&present.length>1)fail('headerPages','three-page header trials cannot combine with other elements');
    }
    const styleKind=first('namedStyle')?.kind;
    for(const sample of samples){
      const original=validated.samples.find(s=>s.id===sample.id);
      if(original?.features){
        if(structural.includes('namedStyle'))fail('namedStyle','fixed features and one style kind required');
        if(Object.keys(original.features).some(group=>!['font','paper','columns','page','typesetting'].includes(group)))fail('features','structural trials accept font, paper, column-format, page-number and typesetting overrides only (horizontal writing)');
      }
      const base=structuredClone(COLUMN_BASE_FEATURES);
      sample.features={...base,...(original?.features?.paper?{paper:original.features.paper}:{}),...(original?.features?.columns?{columns:original.features.columns}:{}),...(original?.features?.page?{page:original.features.page}:{}),...(original?.features?.typesetting?{typesetting:original.features.typesetting}:{}),font:{...base.font,...original?.features?.font}};
      if(structural.includes('namedStyle')&&original?.layoutPriority)fail('namedStyle','fixed features and one style kind required');
      sample.layoutPriority=original?.layoutPriority??'counts';
      if(structural.includes('footnote'))sample.footnote=original?.footnote??(validated.samples.some(s=>s.footnote?.steps)?{steps:[]}:{text:null});
      if(structural.includes('namedStyle')){if(original?.namedStyle&&original.namedStyle.kind!==styleKind)fail('namedStyle','fixed features and one style kind required');sample.namedStyle=original?.namedStyle??{kind:styleKind,steps:[]};}
      if(structural.includes('headerSteps'))Object.assign(sample,{headerSteps:original?.headerSteps??[],headerPosition,headerPages});
      if(structural.includes('documentColumns'))sample.documentColumns=original?.documentColumns??[];
      if(original?.columnRange)sample.columnRange=original.columnRange;
      if(original?.frames)sample.frames=original.frames;
      if(original?.headerLayout)sample.headerLayout=original.headerLayout;
      if(original?.namedStyles)sample.namedStyles=original.namedStyles;
    }
  }
  if (bodyCheck) for (const sample of samples) {
    if (STRUCTURAL_FIELDS.some(key => sample[key] !== undefined)) fail('experiment.bodyCheck', 'combines with plain text samples only');
    if (sample.features?.layout?.orientation === 2) fail('experiment.bodyCheck', 'requires horizontal writing');
  }
  return { schemaVersion, name, text, defaults, ...(styleSource ? { styleSource } : {}), ...(bodyCheck ? { bodyCheck } : {}), samples, ...(validated.targets?{targets:validated.targets}:{}),...(validated.keisenCanvas?{keisenCanvas:validated.keisenCanvas}:{}),...(validated.paragraphTargets?{paragraphTargets:validated.paragraphTargets}:{}) };
}

/** Read UTF-8 JSON (including an optional BOM) and return an expanded plan. */
export async function loadExperiment(path, options = {}) {
  const source = await readFile(path, 'utf8');
  let input;
  try {
    input = JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new ExperimentValidationError('experiment', `invalid JSON: ${error.message}`);
  }
  return expandExperiment(input, options);
}

/** Compact metadata for an already expanded plan. Text length is UTF-16 units. */
export function summarizeExperiment(plan) {
  if (!plan || !Array.isArray(plan.samples) || typeof plan.text !== 'string') {
    fail('plan', 'must be an expanded experiment plan');
  }
  const changed = new Set(plan.samples.flatMap((sample) => sample.changedFields));
  return {
    name: plan.name,
    sampleCount: plan.samples.length,
    textLength: plan.text.length,
    changedFields: STYLE_FIELDS.filter((field) => changed.has(field)),
    baselineIncluded: plan.samples.some((sample) => sample.id === 'baseline'),
  };
}
