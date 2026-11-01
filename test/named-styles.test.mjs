import test from 'node:test';
import os from 'node:os';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {validateNamedStyle,namedStyleMacro,verifyNamedStyle} from '../src/named-styles.mjs';
import {expandExperiment} from '../src/experiment.mjs';
import path from 'node:path';import {runMacroExperiment} from '../src/macro-run.mjs';import {observeRun} from '../src/observation.mjs';
const text='保護甲\n対象乙\n保護丙',steps=['define','apply','direct','redefine','clear'];
function evidence(kind){const meta={};for(const [stage,n] of [['initial',0],...steps.map((_,i)=>['step-'+i,i+1]),['before-save',5],['reopened',5]]){const b='namedStyle.'+stage+'.';meta[b+'registeredCount']=n?'1':'0';if(n)meta[b+'registered.1']='AgentTrial'+kind;for(const [p,line] of text.split('\n').entries())for(const [k,char] of [...line].entries()){const key=b+p+'.'+k;meta[key+'.char']=char;meta[key+'.point']=p===1&&n>=2?(n>=3?'14':'12'):'10.5';meta[key+'.direct']=p===1&&n>=3?'14':'10.5';meta[key+'.paragraphStyle']=kind==='paragraph'&&p===1&&n>=2&&n<5?'AgentTrial'+kind:'';}}return meta;}
test('named styles separate registration, effective point, direct size and paragraph assignment',()=>{
 for(const kind of ['character','paragraph']){const trial={kind,steps},meta=evidence(kind);assert.equal(verifyNamedStyle(meta,{text,trial}).proof.passed,true);
  for(const [key,value] of [['namedStyle.step-1.1.0.point','10.5'],['namedStyle.step-1.1.0.direct','12'],['namedStyle.reopened.0.2.point','14'],['namedStyle.reopened.1.1.char','漏'],['namedStyle.step-3.registered.1','Other']])assert.equal(verifyNamedStyle({...meta,[key]:value},{text,trial}).proof.passed,false);
  const missing={...meta};delete missing['namedStyle.reopened.2.1.point'];assert.throws(()=>verifyNamedStyle(missing,{text,trial}),/Missing/);
  const code=namedStyleMacro({text,trial,q:JSON.stringify}).apply.join('\n');assert.ok(code.includes('GetCharacterPoint()'));assert.ok(!code.includes('RecordCharacterStyle'));assert.ok(code.includes(',,,,,16)'));
 }
});
test('named style recipes reject unsupported sequence, values and mixed scope',async()=>{
 for(const bad of [{kind:'system',steps:[]},{kind:'character',steps:['apply']},{kind:'paragraph',steps:Array(1)},{kind:'character',steps:[],size:20}])assert.throws(()=>validateNamedStyle(bad,text));
 const recipe=JSON.parse(await fs.readFile(new URL('../examples/named-style-paragraph.json',import.meta.url),'utf8'));const plan=expandExperiment(recipe);assert.deepEqual(plan.samples[0].namedStyle,{kind:'paragraph',steps:[]});assert.equal(plan.samples[1].features.font.size,10.5);
 assert.throws(()=>expandExperiment({...recipe,samples:[{...recipe.samples[0],headerSteps:[]}]}));
 assert.throws(()=>expandExperiment({...recipe,samples:[recipe.samples[0],{id:'other',settings:{},namedStyle:{kind:'character',steps:[]}}]}));
});
test('named-style execution carries exact trial, rejects absent proof and preserves next recipe',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ichitaro-named-style-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const recipe=JSON.parse(await fs.readFile(new URL('../examples/named-style-paragraph.json',import.meta.url),'utf8'));
 for(const missing of [false,true]){let calls=0;const adapter={connect:async()=>({test:true}),createSample:async({sample,settings,namedStyle})=>{
  assert.deepEqual(namedStyle,calls?recipe.samples[calls-1].namedStyle:{kind:'paragraph',steps:[]});calls++;await fs.writeFile(sample.documentPath,'fixture '+sample.id);
  return {source:'fixture',resultBytes:Buffer.from('fixture','utf16le'),observed:{'before-save':{settings,fullName:sample.documentPath},reopened:{settings,fullName:sample.documentPath}},body:recipe.text,launch:{},durationMs:1,verification:{method:'macro-getter',passed:true,reopened:true,bodyMatches:true,differences:[],...(!missing?{namedStyleProof:{version:1,trial:namedStyle,passed:true,reopened:true,checks:[],limitations:[]}}:{})}};
 }};
 if(missing){await assert.rejects(runMacroExperiment(recipe,{adapter,outputRoot:root}),/matching proof/);assert.equal(calls,1);}else{const run=await runMacroExperiment(recipe,{adapter,outputRoot:root});const outputDirectory=path.join(root,'observe');await observeRun(run.runDir,{outputDirectory,referenceId:'clear'});const next=JSON.parse(await fs.readFile(path.join(outputDirectory,'next-probes.json'),'utf8'));assert.deepEqual(next.samples[0].namedStyle,recipe.samples.at(-1).namedStyle);assert.equal(calls,6);}
 }
});
