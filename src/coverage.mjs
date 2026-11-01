import { validateExperiment, STYLE_FIELDS, DEFAULT_MAX_SAMPLES } from './experiment.mjs';
import { FEATURE_GROUPS } from './features.mjs';

/** Expand explicit axes into a reviewable recipe before dispatching anything. */
export function generateCoverage(spec) {
  const require = (ok, message) => { if (!ok) throw new Error(message); };
  require(spec && typeof spec === 'object' && !Array.isArray(spec), 'Coverage must be an object.');
  const allowed = new Set(['schemaVersion','name','text','defaults','mode','axes','repeats','layoutPriority']);
  require(Object.keys(spec).every(k => allowed.has(k)), 'Unknown coverage property.');
  require(spec.schemaVersion === 1, 'Coverage schemaVersion must be 1.');
  require(['one-factor','cartesian'].includes(spec.mode), 'mode must be one-factor or cartesian.');
  require(Array.isArray(spec.axes) && spec.axes.length > 0, 'axes must be nonempty.');
  const repeats = spec.repeats ?? 1;
  require(Number.isInteger(repeats) && repeats >= 1 && repeats <= 20, 'repeats must be 1..20.');
  const seen = new Set();
  for (const axis of spec.axes) {
    require(axis && Object.keys(axis).every(k => ['field','values'].includes(k)), 'Invalid axis.');
    const parts = typeof axis.field === 'string' ? axis.field.split('.') : [];
    require((parts.length === 1 && STYLE_FIELDS.includes(parts[0])) ||
      (parts.length === 3 && parts[0] === 'features' && Object.hasOwn(FEATURE_GROUPS,parts[1]) && Object.hasOwn(FEATURE_GROUPS[parts[1]].fields,parts[2])), 'Unknown axis field.');
    require(!seen.has(axis.field), 'Duplicate axis field.'); seen.add(axis.field);
    require(Array.isArray(axis.values) && axis.values.length > 0 && axis.values.length <= DEFAULT_MAX_SAMPLES, 'Axis values must be nonempty and bounded.');
    require(new Set(axis.values.map(v=>JSON.stringify(v))).size === axis.values.length, 'Duplicate axis value.');
  }
  const count = spec.mode === 'one-factor' ? spec.axes.reduce((n,a)=>n+a.values.length,0) : spec.axes.reduce((n,a)=>n*a.values.length,1);
  // Include a baseline and one unchanged baseline copy per repeat as controls.
  require(Number.isSafeInteger(count) && 1 + repeats*(count+1) <= DEFAULT_MAX_SAMPLES, 'Coverage exceeds 200 samples including controls.');
  let combinations = spec.mode === 'one-factor' ? spec.axes.flatMap(a=>a.values.map(v=>[[a.field,v]])) : [[]];
  if (spec.mode === 'cartesian') for (const axis of spec.axes) combinations = combinations.flatMap(c=>axis.values.map(v=>[...c,[axis.field,v]]));
  const samples = [];
  for (let repeat=1; repeat<=repeats; repeat++) {
    samples.push({id:`control-r${repeat}`,settings:{}});
    for (let index=0; index<combinations.length; index++) {
      const sample = {id:`case-${String(index+1).padStart(3,'0')}-r${repeat}`,settings:{}};
      if (spec.layoutPriority !== undefined) sample.layoutPriority = spec.layoutPriority;
      for (const [field,value] of combinations[index]) {
        const parts=field.split('.');
        if (parts.length===1) sample.settings[field]=value;
        else { sample.features??={}; sample.features[parts[1]]??={}; sample.features[parts[1]][parts[2]]=value; }
      }
      samples.push(sample);
    }
  }
  return validateExperiment({schemaVersion:1,name:spec.name,text:spec.text,defaults:spec.defaults,samples});
}
