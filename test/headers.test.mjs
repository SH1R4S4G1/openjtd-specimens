import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {validateHeaderSteps,headerMacro,verifyHeader} from '../src/headers.mjs';
import {expandExperiment} from '../src/experiment.mjs';
import path from 'node:path';
import {runMacroExperiment} from '../src/macro-run.mjs';
import {observeRun} from '../src/observation.mjs';
test('header recipe bounds, isolation and baseline are explicit',async()=>{
 const recipe=JSON.parse(await fs.readFile(new URL('../examples/document-header.json',import.meta.url),'utf8'));
 const plan=expandExperiment(recipe);assert.deepEqual(plan.samples[0].headerSteps,[]);assert.equal(plan.samples[1].features.font.japaneseName,'游明朝');
 for(const steps of [[null],['a\nb'],['a'.repeat(25)],Array(1)])assert.throws(()=>validateHeaderSteps(steps,recipe.text));
 assert.deepEqual(expandExperiment({...recipe,samples:[{...recipe.samples[0],documentColumns:[2]}]}).samples[1].documentColumns,[2]);
 assert.throws(()=>expandExperiment({...recipe,samples:[{...recipe.samples[0],namedStyle:{kind:'character',steps:[]}}]}),/cannot combine|Named style/);
 // Document style is no longer fixed for structural trials; the header proof does not depend on it.
 assert.equal(expandExperiment({...recipe,defaults:{...recipe.defaults,lines:30}}).samples[1].settings.lines,30);
 const code=headerMacro({text:recipe.text,steps:['甲',''],q:JSON.stringify}).apply.join('\n');
 assert.ok(code.indexOf('ViewImageMarginArea(1)')<code.indexOf('JumpHeaderFooter(1,1)'));
});
function fixture(){
 const text='本文甲\n本文乙\n本文丙',steps=['見出し甲',''],meta={};
 for(const [stage,value] of [['initial',''],['step-0','見出し甲'],['step-1',''],['before-save',''],['reopened','']]){
  const b='header.'+stage+'.';for(let p=1;p<=4;p++)for(const [k,v] of Object.entries({'付ける':p===1&&value?'1':'0','ﾏｰｼﾞﾝ':p===1?'20':'0','ﾏｰｼﾞﾝ設定単位':'1','文字列1':p===1?value:'','文字列2':'','文字列3':''}))meta[b+p+'.'+k]=v;
  for(const key of ['振り分け','奇数偶数で別','和文ﾌｫﾝﾄ名','和文ｽﾀｲﾙ名','欧文ﾌｫﾝﾄ名','欧文ｽﾀｲﾙ名','数字ﾌｫﾝﾄ','文字ｻｲｽﾞ設定','文字ｻｲｽﾞ','文字ｻｲｽﾞ単位','拡大率設定','縦拡大率','横拡大率'])meta[b+'global.'+key]='0';
  if(value)Object.assign(meta,{[b+'area']:'4',[b+'page']:'1',[b+'x']:'30',[b+'y']:'20',[b+'lines']:'1',[b+'text.1']:value});
  meta[b+'bodyArea']='1';meta[b+'bodyLines']='3';text.split('\n').forEach((v,i)=>meta[b+'body.'+(i+1)]=v);
 }return {meta,text,steps};
}
test('header verifier rejects body mistaken for header, leakage, missing flag and failed clear',()=>{
 const {meta,text,steps}=fixture();assert.equal(verifyHeader(meta,{text,steps}).proof.passed,true);
 for(const [key,value] of [['header.step-0.area','1'],['header.step-0.page','2'],['header.step-0.text.1','本文甲'],['header.reopened.1.付ける','1'],['header.before-save.2.文字列1','漏れ'],['header.reopened.body.2','本文甲']])assert.equal(verifyHeader({...meta,[key]:value},{text,steps}).proof.passed,false,key);
 delete meta['header.reopened.1.付ける'];assert.throws(()=>verifyHeader(meta,{text,steps}),/Missing/);
});
test('header batch passes history to adapter, renders proof, rejects absent proof and preserves repeat recipes',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ichitaro-header-run-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const recipe=JSON.parse(await fs.readFile(new URL('../examples/document-header.json',import.meta.url),'utf8'));
 for(const missing of [false,true]){
  let calls=0;const adapter={connect:async()=>({test:true}),createSample:async({sample,settings,headerSteps,headerPosition,headerPages})=>{
   assert.equal(headerPosition,1);
   assert.deepEqual(headerSteps,calls?recipe.samples[calls-1].headerSteps:[]);calls++;
   await fs.writeFile(sample.documentPath,'fixture '+sample.id);
   return {source:'fixture',resultBytes:Buffer.from('fixture','utf16le'),observed:{'before-save':{settings,fullName:sample.documentPath},reopened:{settings,fullName:sample.documentPath}},body:recipe.text,launch:{},durationMs:1,verification:{method:'macro-getter',passed:true,reopened:true,bodyMatches:true,differences:[],...(!missing?{headerProof:{version:3,pages:headerPages,position:headerPosition,steps:headerSteps,passed:true,reopened:true,checks:[],limitations:[]}}:{})}};
  }};
  if(missing){await assert.rejects(runMacroExperiment(recipe,{outputRoot:root,adapter}),/matching structural proof/);assert.equal(calls,1);}
  else {const result=await runMacroExperiment(recipe,{outputRoot:root,adapter});assert.equal(calls,5);const outputDirectory=path.join(root,'observe');await observeRun(result.runDir,{outputDirectory,referenceId:'header-clear'});const next=JSON.parse(await fs.readFile(path.join(outputDirectory,'next-probes.json'),'utf8'));assert.ok(JSON.stringify(next).includes('headerSteps'));}
 }
});
test('three-page header rejects wrong ownership, reordered body, extra page and missing evidence',async()=>{
 const recipe=JSON.parse(await fs.readFile(new URL('../examples/document-header-pages.json',import.meta.url),'utf8'));
 assert.ok(expandExperiment(recipe).samples.every(s=>s.headerPages===3));
 assert.throws(()=>expandExperiment({...recipe,samples:[{...recipe.samples[0],headerPages:2}]}));
 assert.throws(()=>expandExperiment({...recipe,samples:[recipe.samples[0],{...recipe.samples[1],headerPages:1}]}));
 const {meta,text,steps}=fixture();
 for(const [stage,value] of [['initial',''],['step-0','見出し甲'],['step-1',''],['before-save',''],['reopened','']]){
  const b='header.'+stage+'.pages.';meta[b+'last']='3';
  text.split('\n').forEach((line,p)=>{const k=b+(p+1)+'.';meta[k+'bodyArea']='1';for(const [i,c] of [...line].entries()){meta[k+'char.'+i]=c;meta[k+'charPage.'+i]=String(p+1);}if(value)Object.assign(meta,{[k+'area']:'4',[k+'number']:String(p+1),[k+'text.1']:value,[k+'lines']:'1'});});
 }
 assert.equal(verifyHeader(meta,{text,steps,pages:3}).proof.passed,true);
 for(const [key,value] of [['header.step-0.pages.2.number','1'],['header.reopened.pages.3.charPage.0','2'],['header.reopened.pages.2.char.2','甲'],['header.reopened.pages.last','4']])assert.equal(verifyHeader({...meta,[key]:value},{text,steps,pages:3}).proof.passed,false);
 delete meta['header.reopened.pages.3.char.1'];assert.throws(()=>verifyHeader(meta,{text,steps,pages:3}),/Missing/);
});
test('footer uses lower area, guards upper settings, and fixes position across baseline and variants',async()=>{
 const recipe=JSON.parse(await fs.readFile(new URL('../examples/document-footer.json',import.meta.url),'utf8'));
 assert.ok(expandExperiment(recipe).samples.every(s=>s.headerPosition===2));
 for(const position of [0,3,'2',null])assert.throws(()=>expandExperiment({...recipe,samples:[{...recipe.samples[0],headerPosition:position}]}));
 assert.throws(()=>expandExperiment({...recipe,samples:[recipe.samples[0],{...recipe.samples[1],headerPosition:1}]}));
 const {meta,text,steps}=fixture(),lower={};
 for(const [key,value] of Object.entries(meta)){const k=key.replace(/^(header\.[^.]+\.)1\./,'$1SWAP.').replace(/^(header\.[^.]+\.)2\./,'$11.').replace('.SWAP.','.2.');lower[k]=key.endsWith('.area')?'5':value;}
 assert.equal(verifyHeader(lower,{text,steps,position:2}).proof.passed,true);
 assert.equal(verifyHeader({...lower,'header.step-0.area':'4'},{text,steps,position:2}).proof.passed,false);
 assert.equal(verifyHeader({...lower,'header.reopened.1.文字列1':'漏れ'},{text,steps,position:2}).proof.passed,false);
 const code=headerMacro({text,steps,position:2,q:JSON.stringify}).apply.join('\n');assert.ok(code.includes('JumpHeaderFooter(2,1)'));assert.ok(code.includes('HeaderFooterEach(2,1,20,1,'));
});

