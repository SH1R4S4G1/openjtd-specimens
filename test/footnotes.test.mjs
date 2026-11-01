import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {validateFootnote,footnoteMacro,footnoteBody,verifyFootnote} from '../src/footnotes.mjs';
import {expandExperiment} from '../src/experiment.mjs';
import {runMacroExperiment} from '../src/macro-run.mjs';
import {observeRun} from '../src/observation.mjs';
import {buildMacroCatalog} from '../src/macro-catalog.mjs';
const text='保護甲乙\n対象丙丁\n保護戊己',trial={text:'脚注本文甲乙'};
function metaFor(trial){const meta={};if(trial.text!==null)Object.assign(meta,{'footnote.insertArea':'3','footnote.contentArea':'3','footnote.prefixCount':'1','footnote.prefix.1':'*1'});
 for(const stage of ['initial','before-save','reopened']){const active=stage!=='initial'&&trial.text!==null,b='footnote.'+stage+'.';
  footnoteBody(text,{text:active?trial.text:null}).split('\n').forEach((s,p)=>[...s].forEach((c,k)=>meta[b+'body.'+p+'.'+k]=c));meta[b+'bodyArea']='1';
  if(active)for(const [k,v] of Object.entries({number:'1',noteArea:'3',noteOpen:'TRUE',noteCount:'1',returnArea:'1',returnNumber:'1',returnChar:'1','note.1':'*1'+trial.text}))meta[b+k]=v;
 }return meta;
}
test('footnote proof detects wrong content, anchor, body, area and missing getters',()=>{
 const meta=metaFor(trial);assert.equal(verifyFootnote(meta,{text,trial}).proof.passed,true);
 for(const [k,v] of [['footnote.reopened.note.1','*1別内容'],['footnote.reopened.returnNumber','2'],['footnote.before-save.body.0.0','誤'],['footnote.reopened.noteArea','1'],['footnote.contentArea','1']])assert.equal(verifyFootnote({...meta,[k]:v},{text,trial}).proof.passed,false);
 const missing={...meta};delete missing['footnote.reopened.returnNumber'];assert.throws(()=>verifyFootnote(missing,{text,trial}),/Missing/);
 const code=footnoteMacro({text,trial,q:JSON.stringify}).apply.join('\n');assert.ok(code.includes('Footnote("%1",1)'));assert.ok(code.includes('JumpFootnote(2,1)'));
 assert.equal(verifyFootnote(metaFor({text:null}),{text,trial:{text:null}}).proof.passed,true);
});
test('footnote validator isolates scope and preserves a controlled baseline',async()=>{
 for(const v of [{},{text:''},{text:'a\nb'},{text:'😀'},{text:'a'.repeat(25)},{text:'a',unknown:1}])assert.throws(()=>validateFootnote(v,text));
 const recipe=JSON.parse(await fs.readFile('examples/footnote-single.json','utf8')),plan=expandExperiment(recipe);
 assert.deepEqual(plan.samples[0].footnote,{text:null});assert.equal(plan.samples[1].features.font.japaneseName,'游明朝');
 for(const extra of [{namedStyle:{kind:'character',steps:[]}},{documentColumns:[2]},{features:{layout:{orientation:2}}}])assert.throws(()=>expandExperiment({...recipe,samples:[{...recipe.samples[0],...extra}]}));
});
test('footnote execution, catalog and next-probe retain matching proof; missing proof stops execution',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ichitaro-footnote-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const recipe=JSON.parse(await fs.readFile('examples/footnote-single.json','utf8'));
 for(const missing of [false,true]){let calls=0;const adapter={connect:async()=>({test:true}),createSample:async({sample,settings,footnote})=>{
  calls++;assert.deepEqual(footnote,calls===1?{text:null}:recipe.samples[calls-2].footnote);await fs.writeFile(sample.documentPath,'fixture '+sample.id);
  const proof=verifyFootnote(metaFor(footnote),{text:recipe.text,trial:footnote}).proof;
  return {source:'fixture',resultBytes:Buffer.from('fixture','utf16le'),observed:{'before-save':{settings,fullName:sample.documentPath},reopened:{settings,fullName:sample.documentPath}},body:footnoteBody(recipe.text,footnote),launch:{},durationMs:1,verification:{method:'macro-getter',passed:true,reopened:true,bodyMatches:true,differences:[],...(missing?{}:{footnoteProof:proof})}};
 }};
 if(missing){await assert.rejects(runMacroExperiment(recipe,{adapter,outputRoot:root}),/matching proof/);assert.equal(calls,1);}
 else{const result=await runMacroExperiment(recipe,{adapter,outputRoot:root});assert.equal(calls,3);const outputDirectory=path.join(root,'observation');await observeRun(result.runDir,{outputDirectory,referenceId:'note-short'});const next=JSON.parse(await fs.readFile(path.join(outputDirectory,'next-probes.json'),'utf8'));assert.ok(next.samples.some(s=>s.footnote?.text===recipe.samples[0].footnote.text));const catalog=await buildMacroCatalog({helpDirectory:root,runDirectories:[result.runDir]});assert.equal(catalog.capabilities.find(c=>c.id==='document-footnote').evidence.length,2);assert.equal(catalog.capabilities.find(c=>c.id==='document-footnote').stages.reopenedVerified,true);}
 }
});
