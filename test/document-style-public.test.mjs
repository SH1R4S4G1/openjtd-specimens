import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {compileCatalog} from '../src/sample-catalog.mjs';
import {runMacroExperiment} from '../src/macro-run.mjs';
const load=async()=>JSON.parse(await fs.readFile('examples/agent/10-document-style.json','utf8'));
test('public document style compiles priority values; dependent values stay optional assertions',async()=>{
 const input=await load(),before=structuredClone(input),jobs=compileCatalog(input).jobs;
 assert.deepEqual(input,before);
 assert.equal(jobs[1].recipe.samples[0].settings.chars,36);
 assert.equal(jobs[1].recipe.samples[0].settings.characterSpacing,undefined);
 assert.equal(jobs[2].recipe.samples[0].layoutPriority,'spacing');
 assert.equal(jobs[2].recipe.samples[0].settings.chars,undefined);
 assert.equal(jobs[0].recipe.samples[0].features.font.japaneseName,'游明朝');
 for(const mutate of [s=>delete s.chars,s=>s.lines=2.5,s=>s.marginLeft=-1,s=>s.layoutPriority='preserve',s=>s.orientation=2]){
  const bad=await load();mutate(bad.samples[0].document.style);assert.throws(()=>compileCatalog(bad),{code:'ERR_SAMPLE_SCHEMA'});
 }
 // Style may combine with font and annotations; the font override merges into the fixed base font.
 const withFont=await load();Object.assign(withFont.samples[0].document,{font:{sizePt:12}});
 assert.deepEqual(compileCatalog(withFont).jobs[0].recipe.samples[0].features.font,{japaneseName:'游明朝',japaneseStyle:'標準',westernName:10,digitFont:11,size:12,sizeUnit:3,scaleX:100,scaleY:100});
 const empty=await load();Object.assign(empty.samples[0].document,{annotations:[]});assert.throws(()=>compileCatalog(empty));
 const strict=await load();strict.samples[0].document.style.characterSpacing=1;
 assert.equal(compileCatalog(strict).jobs[0].recipe.samples[0].settings.characterSpacing,1);
});
test('runner forwards explicit baseline-equal assertions and omits unspecified coupled values',async t=>{
 const recipe=compileCatalog(await load()).jobs[1].recipe;
 recipe.samples[0].settings.characterSpacing=1; // explicit baseline-equal assertion
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ichitaro-style-public-test-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));let calls=0;
 const adapter={connect:async()=>({test:true}),createSample:async({sample,settings})=>{
  if(calls++){assert.equal(settings.characterSpacing,1);assert.equal(settings.marginLeft,30);assert.equal(settings.chars,36);assert.equal(settings.lineSpacing,undefined);}
  await fs.writeFile(sample.documentPath,'test fixture');
  return {source:'fixture',resultBytes:Buffer.from('fixture','utf16le'),observed:{'before-save':{settings,fullName:sample.documentPath},reopened:{settings,fullName:sample.documentPath}},body:recipe.text,launch:{},durationMs:1,verification:{method:'macro-getter',passed:true,reopened:true,bodyMatches:true,differences:[]}};
 }};
 await runMacroExperiment(recipe,{adapter,outputRoot:root});assert.equal(calls,2);
});

