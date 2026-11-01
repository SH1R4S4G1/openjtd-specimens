import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {runMacroExperiment} from '../src/macro-run.mjs';
import {verifyRun} from '../src/evidence.mjs';
import {buildMacroCatalog} from '../src/macro-catalog.mjs';
import {observeRun} from '../src/observation.mjs';

test('decoration batches preserve saved review status and stop on a real getter mismatch',async t=>{
 for(const recipeName of ['paragraph-decoration','paragraph-decoration-color-fill']){
 const recipe=JSON.parse(await fs.readFile(new URL('../examples/'+recipeName+'.json',import.meta.url),'utf8'));
 const count=recipe.samples.length;
 const parent=os.tmpdir();
 const root=await fs.mkdtemp(path.join(parent,'paragraph-review-test-'));
 t.after(()=>{assert.ok(path.resolve(root).startsWith(path.resolve(parent)+path.sep+'paragraph-review-test-'));return fs.rm(root,{recursive:true,force:true});});
 for(const mismatch of [false,true]){
  let calls=0;
  const adapter={connect:async()=>({test:true}),createSample:async({sample,settings,paragraphOperations})=>{
   calls++;await fs.writeFile(sample.documentPath,'fake fixture JTD '+calls);
   const decoration=paragraphOperations.length>0;
   return {source:'fixture macro',resultBytes:Buffer.from('fixture result'),observed:{'before-save':{settings,fullName:sample.documentPath},reopened:{settings,fullName:sample.documentPath}},body:recipe.text,launch:{},durationMs:1,
    verification:{method:'macro-getter',passed:!decoration,reopened:true,bodyMatches:true,differences:mismatch&&decoration?[{field:'outside paragraph'}]:[],paragraphProof:{version:2,reopened:true,characterIdentityVerified:true,passed:!decoration,reviewRequired:decoration,decorationVerified:false,checks:[],limitations:[]}}};
  }};
  if(mismatch){await assert.rejects(runMacroExperiment(recipe,{adapter,outputRoot:root}),/readback did not match/);assert.equal(calls,2);}
  else{
   const result=await runMacroExperiment(recipe,{adapter,outputRoot:root});
   assert.equal(result.reviewRequiredCount,count);assert.equal(calls,count+1);
   const index=JSON.parse(await fs.readFile(path.join(result.runDir,'index.json'),'utf8'));
   assert.equal(index.samples.find(s=>s.id==='baseline').status,'verified');
   for(const s of index.samples.filter(s=>s.id!=='baseline')){assert.equal(s.status,'saved');assert.equal(s.verification.passed,false);}
   assert.equal((await verifyRun(result.runDir)).ok,true);
   const catalog=await buildMacroCatalog({helpDirectory:root,runDirectories:[result.runDir]});
   const capability=catalog.capabilities.find(c=>c.id==='paragraph-decoration');
   assert.equal(capability.pendingReviewEvidence.length,count);
   assert.equal(capability.stages.runtimeApplied,false);assert.equal(capability.stages.reopenedVerified,false);
   await assert.rejects(observeRun(result.runDir,{outputDirectory:path.join(root,'observation')}),/Only verified samples/);
  }
 }
 }
});
