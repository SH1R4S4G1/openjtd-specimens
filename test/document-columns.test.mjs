import test from 'node:test';
import assert from 'node:assert/strict';
import {columnsMacro,verifyColumns,validateDocumentColumns,validateColumnRange} from '../src/document-columns.mjs';
import {expandExperiment} from '../src/experiment.mjs';
import fs from 'node:fs/promises';
test('whole-document columns reject mixed scope and preserve controlled baseline',async()=>{
 const recipe=JSON.parse(await fs.readFile(new URL('../examples/document-columns.json',import.meta.url),'utf8'));
 const plan=expandExperiment(recipe);assert.deepEqual(plan.samples[0].documentColumns,[]);
 assert.equal(plan.samples[0].features.font.japaneseName,'游明朝');
 assert.throws(()=>validateDocumentColumns([4],recipe.text));
 assert.throws(()=>validateDocumentColumns([2],'空 白\n中\n末'));
 // Paragraph attributes may combine with columns; named styles stay isolated.
 assert.ok(expandExperiment({...recipe,paragraphTargets:[{id:'a',index:1,expected:recipe.text.split('\n')[0]}]}).samples.every(s=>Array.isArray(s.documentColumns)));
 assert.throws(()=>expandExperiment({...recipe,samples:[{...recipe.samples[0],namedStyle:{kind:'character',steps:[]}}]}),/cannot combine|Named style/);
 const macro=columnsMacro({text:recipe.text,steps:[2,3,1,2],q:JSON.stringify}).apply.join('\n');
 assert.equal((macro.match(/CancelColumns\(\)/g)||[]).length,2);
 assert.ok(macro.indexOf('CancelColumns()')<macro.indexOf('Columns(3)'));
});
test('column proof detects nested residual count, missing characters and reordered logical paragraphs',()=>{
 const text='甲乙\n丙丁\n戊己',steps=[2,3,1],meta={};
 for(const [stage,count] of [['initial',1],['step-0',2],['cleared-1',1],['step-1',3],['cleared-2',1],['step-2',1],['before-save',1],['reopened',1]])for(const [p,line] of text.split('\n').entries()){
  const base=`columns.${stage}.${p}`;for(const [k,c] of [...line].entries()){meta[base+'.'+k+'.char']=c;meta[base+'.'+k+'.count']=String(count);}
  meta[base+'.lines']='2';meta[base+'.text.1']='';meta[base+'.text.2']=line;
 }
 assert.equal(verifyColumns(meta,{text,steps}).proof.passed,true);
 for(const [key,value] of [['columns.cleared-1.1.0.count','2'],['columns.reopened.0.1.char','甲'],['columns.step-0.1.text.2','戊己']])assert.equal(verifyColumns({...meta,[key]:value},{text,steps}).proof.passed,false);
 const missing={...meta};delete missing['columns.reopened.0.1.char'];assert.throws(()=>verifyColumns(missing,{text,steps}),/Missing/);
});
test('column ranges open a section at the first paragraph and close it after the last',()=>{
 const text='甲乙\n丙丁\n戊己\n庚辛';
 assert.deepEqual(validateColumnRange({from:1,to:2},[2],text),{from:1,to:2});
 for(const [range,steps] of [[{from:0,to:3},[2]],[{from:2,to:1},[2]],[{from:1,to:4},[2]],[{from:1,to:2},[2,3]],[{from:1,to:2},[1]],[{from:1,to:2,extra:1},[2]]])assert.throws(()=>validateColumnRange(range,steps,text));
 const apply=columnsMacro({text,steps:[3],q:JSON.stringify,range:{from:1,to:2}}).apply.join('\n');
 assert.ok(apply.indexOf('Columns(3)')<apply.indexOf('CancelColumns()'));assert.ok(apply.includes('NextParagraph(3)'));
 assert.ok(!columnsMacro({text,steps:[2],q:JSON.stringify,range:{from:2,to:3}}).apply.includes('CancelColumns()'));
 const meta={};const counts={initial:[1,1,1,1],'step-0':[1,2,2,1],'before-save':[1,2,2,1],reopened:[1,2,2,1]};
 for(const [stage,list] of Object.entries(counts))for(const [p,line] of text.split('\n').entries()){const base=`columns.${stage}.${p}`;[...line].forEach((c,k)=>{meta[base+'.'+k+'.char']=c;meta[base+'.'+k+'.count']=String(list[p]);});meta[base+'.lines']='1';meta[base+'.text.1']=line;}
 assert.equal(verifyColumns(meta,{text,steps:[2],range:{from:1,to:2}}).proof.passed,true);
 assert.equal(verifyColumns({...meta,'columns.reopened.3.0.count':'2'},{text,steps:[2],range:{from:1,to:2}}).proof.passed,false);
});
