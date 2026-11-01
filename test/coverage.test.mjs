import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateCoverage } from '../src/coverage.mjs';
import { validateFeatures } from '../src/features.mjs';
import { expandExperiment } from '../src/experiment.mjs';
const base=JSON.parse(await readFile(new URL('../examples/style-matrix.json',import.meta.url),'utf8'));
function spec(overrides={}) { return {schemaVersion:1,name:'coverage',text:base.text,defaults:base.defaults,mode:'one-factor',axes:[{field:'chars',values:[38,39]},{field:'features.font.size',values:[10,12]}],...overrides}; }
test('one-factor coverage isolates axes, repeats independent controls and expands feature requests',()=>{
  const recipe=generateCoverage(spec({repeats:2}));
  assert.equal(recipe.samples.length,10);
  assert.deepEqual(recipe.samples[0],{id:'control-r1',settings:{}});
  assert.deepEqual(recipe.samples[3].features,{font:{size:10}});
  assert.deepEqual(recipe.samples[3].settings,{});
  const plan=expandExperiment(recipe);
  assert.equal(plan.samples.length,11);
  assert.deepEqual(plan.samples[4].features,{font:{size:10}});
  recipe.samples[3].features.font.size=20;
  assert.equal(recipe.samples[8].features.font.size,10);
});
test('Cartesian coverage creates all combinations with deterministic IDs',()=>{
  const recipe=generateCoverage(spec({mode:'cartesian'}));
  assert.deepEqual(recipe.samples.slice(1).map(s=>[s.settings.chars,s.features.font.size]),[[38,10],[38,12],[39,10],[39,12]]);
  assert.deepEqual(generateCoverage(spec({mode:'cartesian'})),recipe);
});
test('coverage rejects oversized products before expansion and invalid values',()=>{
  for(const changes of [{mode:'random'},{repeats:0},{repeats:21},{axes:[]},{axes:[{field:'features.__proto__.x',values:[1]}]},
    {axes:[{field:'chars',values:[1,1]}]}, {axes:[{field:'chars',values:[1]},{field:'chars',values:[2]}]},
    {axes:[{field:'features.font.size',values:[999]}]},
    {mode:'cartesian',axes:[{field:'chars',values:Array.from({length:20},(_,i)=>i+1)},{field:'lines',values:Array.from({length:20},(_,i)=>i+1)}]}]) assert.throws(()=>generateCoverage(spec(changes)));
});
test('feature validation rejects injection, accessors, invalid enums and null requests',()=>{
  let called=false;
  const accessor={}; Object.defineProperty(accessor,'font',{enumerable:true,get(){called=true;return {};}});
  for(const input of [accessor,{font:{size:NaN}},{font:{size:4}},{paper:{name:'A4\nRun()'}},{layout:{orientation:0}},{columns:{twoChars:null}},{unknown:{}}]) assert.throws(()=>validateFeatures(input));
  assert.equal(called,false);
  assert.deepEqual(validateFeatures({font:{westernName:10,size:12},columns:{twoEnabled:1,twoChars:20}}),{font:{westernName:10,size:12},columns:{twoEnabled:1,twoChars:20}});
});
