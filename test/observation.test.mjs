import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { readCfb, physicalSpans } from '../src/cfb.mjs';
import { diffBytes, digest } from '../src/binary-diff.mjs';
import { findAssociations, compareDocuments, inspectBytes, observeRun, observePair } from '../src/observation.mjs';
import { createRun, startSample, saveMacroEvidence, finalizeSample } from '../src/evidence.mjs';
import { buildMacroCatalog } from '../src/macro-catalog.mjs';
import { expandExperiment } from '../src/experiment.mjs';

// Synthetic public CFB structures, not copied application output.
function compound({mini=true,relocated=false,version=3}={}){
  const sector=version===3?512:4096, dataSize=mini?5:4096, dataSectors=Math.ceil((mini?64:dataSize)/sector);
  const dataStart=relocated?4:3, total=dataStart+dataSectors;
  const b=Buffer.alloc((total+1)*sector),u32=(o,v)=>b.writeUInt32LE(v>>>0,o),sec=id=>(id+1)*sector;
  Buffer.from('d0cf11e0a1b11ae1','hex').copy(b);b.writeUInt16LE(version,26);b.writeUInt16LE(0xfffe,28);b.writeUInt16LE(version===3?9:12,30);b.writeUInt16LE(6,32);
  u32(44,1);u32(48,1);u32(56,4096);u32(60,mini?2:0xfffffffe);u32(64,mini?1:0);u32(68,0xfffffffe);
  b.fill(255,76,512);u32(76,0);b.fill(255,sec(0),sec(1));u32(sec(0),0xfffffffd);u32(sec(0)+4,0xfffffffe);u32(sec(0)+8,mini?0xfffffffe:0xffffffff);
  for(let i=0;i<dataSectors;i++)u32(sec(0)+(dataStart+i)*4,i+1===dataSectors?0xfffffffe:dataStart+i+1);
  function entry(index,name,type,start,size,child=0xffffffff){
    const o=sec(1)+index*128;Buffer.from(name+'\0','utf16le').copy(b,o);b.writeUInt16LE((name.length+1)*2,o+64);b[o+66]=type;
    u32(o+68,0xffffffff);u32(o+72,0xffffffff);u32(o+76,child);u32(o+116,start);u32(o+120,size);
  }
  entry(0,'Root Entry',5,mini?dataStart:0xfffffffe,mini?64:0,1);entry(1,'Data',2,mini?0:dataStart,dataSize);
  if(mini){b.fill(255,sec(2),sec(3));u32(sec(2),0xfffffffe);}
  Buffer.from([1,2,3,4,5]).copy(b,sec(dataStart));return b;
}
const key='["Data"]';
test('CFB reads mini/FAT streams at relocated sectors and maps physical bytes',()=>{
  for(const mini of [true,false])for(const relocated of [true,false])for(const version of [3,4]){
    const bytes=compound({mini,relocated,version}),cfb=readCfb(bytes),s=cfb.streams.get(key),sector=version===3?512:4096;
    assert.equal(s.bytes.length,mini?5:4096);assert.equal(s.bytes.subarray(0,5).toString('hex'),'0102030405');
    const spans=physicalSpans(s,1,3);assert.deepEqual(spans,[{offset:1,fileOffset:(relocated?5:4)*sector+1,length:3}]);
    assert.deepEqual(bytes.subarray(spans[0].fileOffset,spans[0].fileOffset+3),s.bytes.subarray(1,4));
  }
  const a=compound(),b=compound({relocated:true}),diff=compareDocuments({bytes:a,cfb:readCfb(a)},{bytes:b,cfb:readCfb(b)});
  assert.ok(diff.raw.changedBytes>0);assert.deepEqual(diff.streams,[]);
});
test('CFB rejects cycles, truncated sectors, invalid directory trees and out-of-bounds streams',()=>{
  const cases=[];
  let b=compound();b.writeUInt32LE(3,512+3*4);cases.push(b);
  b=compound();b.writeUInt32LE(0,1536);cases.push(b);
  b=compound();b.writeUInt32LE(1,1024+128+72);cases.push(b);
  b=compound();b.writeUInt32LE(999,1024+128+116);cases.push(b);
  cases.push(compound().subarray(0,1000));
  for(const bad of cases)assert.throws(()=>readCfb(bad),/CFB:/);
  assert.equal(readCfb(Buffer.from('not CFB')),null);
});
test('positional diff counts changes and tails exactly, bounds output and hashes full ranges',()=>{
  const a=Buffer.from([1,2,3,4,5]),b=Buffer.from([9,2,8,4,5,6]);
  const d=diffBytes(a,b,{maxRanges:2,previewBytes:1});
  assert.equal(d.changedBytes,3);assert.equal(d.rangeCount,3);assert.equal(d.omittedRanges,1);
  assert.deepEqual(d.ranges.map(r=>r.offset),[0,2]);
  const long=diffBytes(Buffer.alloc(100),Buffer.alloc(100,1),{previewBytes:2}).ranges[0];
  assert.equal(long.previewTruncated,true);assert.equal(long.afterHex,'0101');assert.equal(long.afterSha256,digest(Buffer.alloc(100,1)));
  assert.equal(diffBytes(a,a).changedBytes,0);
  const tail=diffBytes(b,a).ranges.at(-1);assert.equal(tail.afterLength,0);assert.equal(tail.beforeHex,'06');
});
function sample(id,value,bytes){return {id,observed:{'features.font.size':value},cfb:{streams:new Map([[key,{key,path:['Data'],bytes:Buffer.from(bytes),spans:[]}]])}};}
test('associations exclude repeat noise, retain co-varying fields, and suppress length-shifted streams',()=>{
  const samples=[sample('a1',10,[10,8,0]),sample('a2',10,[10,9,0]),sample('b1',12,[12,5,0]),sample('b2',12,[12,5,0])];
  for(const s of samples)s.observed['settings.lineSpacing']=s.observed['features.font.size']*2;
  const r=findAssociations(samples);assert.equal(r.variableWithinReplicates,1);assert.equal(r.candidates.length,1);
  assert.equal(r.variableRegions[0].offset,1);assert.deepEqual(r.variableRegions[0].values.map(v=>v.hex),['08','09','05','05']);
  assert.deepEqual(r.candidates[0].fields,['features.font.size','settings.lineSpacing']);assert.equal(r.candidates[0].repeatedObservationGroups,2);
  samples[3].cfb.streams.get(key).bytes=Buffer.from([12,5]);
  assert.equal(findAssociations(samples).candidates.length,0);assert.equal(findAssociations(samples).excludedStreams.length,1);
});
test('association limits report omitted positions instead of silently claiming completeness',()=>{
  const r=findAssociations([sample('a',1,[1,0,1]),sample('b',2,[2,0,2])],{maxCandidates:1,maxPositions:1});
  assert.equal(r.candidates.length,1);assert.equal(r.omittedPositions,1);
});
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ichitaro-observation-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;
}
test('slice returns exact original physical bytes and refuses oversized or missing slices',async t=>{
  const root=await fixture(t),filename=path.join(root,'source.jtd');await fs.writeFile(filename,compound());
  const s=await inspectBytes(filename,{stream:['Data'],offset:1,length:3});assert.equal(s.hex,'020304');assert.equal(s.physical[0].fileOffset,2049);
  await assert.rejects(inspectBytes(filename,{offset:0,length:4097}));await assert.rejects(inspectBytes(filename,{stream:['absent'],offset:0,length:1}));
});
test('unmanaged pair supports raw files without inventing CFB streams or setting associations',async t=>{
  const root=await fixture(t),a=path.join(root,'a.bin'),b=path.join(root,'b.bin');
  await fs.writeFile(a,Buffer.from([1,2,3]));await fs.writeFile(b,Buffer.from([1,9,3,4]));
  const out=path.join(root,'pair'),summary=await observePair(a,b,out),detail=JSON.parse(await fs.readFile(summary.details));
  assert.equal(summary.rawChangedBytes,2);assert.equal(summary.streamComparison,false);
  assert.match(detail.provenance,/not verified/);assert.deepEqual(detail.raw.ranges.map(r=>r.offset),[1,3]);
  await assert.rejects(observePair(a,b,out),{code:'EEXIST'});
});
test('run observation verifies provenance, keeps source bytes unchanged, and never overwrites reports',async t=>{
  const root=await fixture(t),defaults={chars:40,lines:40,characterSpacing:1,lineSpacing:60,marginTop:30,marginBottom:30,marginLeft:30,marginRight:30};
  const run=await createRun({outputRoot:root,experiment:{schemaVersion:1,name:'synthetic',defaults,text:'sample',samples:[{id:'baseline',settings:defaults},{id:'control-1',settings:defaults},{id:'variant',settings:defaults}]}});
  for(const id of ['baseline','control-1','variant']){
    const sample=await startSample(run,{id,requested:{}}),bytes=compound();if(id==='variant')bytes[2048]=12;await fs.writeFile(sample.documentPath,bytes);
    for(const phase of ['before-save','reopened'])await saveMacroEvidence(sample,{label:phase,phase,observed:{settings:defaults,features:{font:{size:id==='variant'?12:10}},body:'sample'},verification:{method:'macro-getter',passed:phase==='reopened',reopened:phase==='reopened'},macroSource:'end\r\n',resultBytes:Buffer.from('synthetic readback','utf16le')});
    await finalizeSample(sample,{verification:{method:'macro-getter',passed:true,reopened:true}});
  }
  const original=await fs.readFile(path.join(run.dir,'samples/variant/document.jtd'));
  const out=path.join(root,'analysis'),result=await observeRun(run.dir,{outputDirectory:out});
  assert.equal(result.reference,'control-1');assert.ok(result.candidateRegions>0);
  assert.deepEqual(await fs.readFile(path.join(run.dir,'samples/variant/document.jtd')),original);
  await assert.rejects(observeRun(run.dir,{outputDirectory:out}),{code:'EEXIST'});
  await assert.rejects(observeRun(run.dir,{outputDirectory:path.join(run.dir,'analysis')}),/outside/);
  await fs.appendFile(path.join(run.dir,'samples/variant/document.jtd'),'tamper');
  await assert.rejects(observeRun(run.dir,{outputDirectory:path.join(root,'other')}),/integrity/);
});

test('legacy drawing-mode table evidence cannot promote catalog coverage or byte associations',async t=>{
  const root=await fixture(t),defaults={chars:40,lines:40,characterSpacing:1,lineSpacing:60,marginTop:30,marginBottom:30,marginLeft:30,marginRight:30};
  const run=await createRun({outputRoot:root,experiment:{schemaVersion:1,name:'legacy',defaults,text:'sample',samples:[{id:'baseline',settings:defaults},{id:'table',settings:defaults}]}});
  for(const id of ['baseline','table']){
    const ops=id==='table'?[{type:'table',rows:[2,4],columns:[3,7],lineType:1,color:'R0G0B0'}]:[];
    const sample=await startSample(run,{id,requested:{keisenOperations:ops}});
    await fs.writeFile(sample.documentPath,compound());
    const verification={method:'macro-getter',passed:true,reopened:true,keisenProof:{passed:true,reopened:true,checks:ops.map(()=>({stage:'step-1',passed:true}))}};
    for(const phase of ['before-save','reopened'])await saveMacroEvidence(sample,{label:phase,phase,observed:{settings:defaults},verification,macroSource:'end\r\n',resultBytes:Buffer.from('legacy','utf16le')});
    await finalizeSample(sample,{verification});
  }
  await assert.rejects(observeRun(run.dir,{outputDirectory:path.join(root,'analysis')}),/Legacy drawing-mode/);
  const helpDirectory=path.join(root,'help');await fs.mkdir(helpDirectory);
  const catalog=await buildMacroCatalog({helpDirectory,runDirectories:[run.dir]});
  assert.equal(catalog.rejectedRuns.length,0,'artifact integrity remains valid');
  assert.equal(catalog.supersededEvidence.length,1);
  assert.equal(catalog.capabilities.find(c=>c.id==='keisen-table').stages.runtimeApplied,false);
});

test('next ruled-line recipes repeat the selected table/cell condition instead of a blank page',async t=>{
  const root=await fixture(t),recipe=JSON.parse(await fs.readFile(new URL('../examples/keisen-cells.json',import.meta.url)));
  recipe.samples=recipe.samples.slice(0,2);const plan=expandExperiment(recipe);
  const run=await createRun({outputRoot:root,experiment:plan});
  for(const spec of plan.samples){
    const sample=await startSample(run,{id:spec.id,requested:{keisenOperations:spec.keisenOperations}});await fs.writeFile(sample.documentPath,compound());
    const verification={method:'macro-getter',passed:true,reopened:true,keisenProof:{version:2,cellGetterMode:'normal-editing',passed:true,reopened:true,checks:[]}};
    for(const phase of ['before-save','reopened'])await saveMacroEvidence(sample,{label:phase,phase,observed:{settings:spec.settings,cellFill:spec.id==='top-left'?50:0},verification,macroSource:'end\r\n',resultBytes:Buffer.from('synthetic normal-mode','utf16le')});
    await finalizeSample(sample,{verification});
  }
  const result=await observeRun(run.dir,{outputDirectory:path.join(root,'analysis'),referenceId:'top-left'});
  const next=JSON.parse(await fs.readFile(result.nextRecipe,'utf8'));expandExperiment(next);
  assert.equal(next.samples.length,4);
  for(const spec of next.samples.slice(0,2))assert.deepEqual(spec.keisenOperations,recipe.samples[1].keisenOperations);
  for(const spec of next.samples.slice(2))assert.deepEqual(spec.keisenOperations,recipe.samples[0].keisenOperations);
  assert.deepEqual(next.keisenCanvas,recipe.keisenCanvas);
});

test('text table evidence needs version 3 exact text proof for catalog and observation',async t=>{
 const root=await fixture(t),recipe=JSON.parse(await fs.readFile(new URL('../examples/keisen-cell-text.json',import.meta.url)));
 recipe.samples=recipe.samples.slice(0,1);const plan=expandExperiment(recipe),helpDirectory=path.join(root,'help');await fs.mkdir(helpDirectory);
 for(const [version,textVerified,accepted] of [[2,false,false],[3,false,false],[3,true,true]]){
  const run=await createRun({outputRoot:root,experiment:plan});
  for(const spec of plan.samples){
   const sample=await startSample(run,{id:spec.id,requested:{keisenOperations:spec.keisenOperations}});await fs.writeFile(sample.documentPath,compound());
   const verification={method:'macro-getter',passed:true,reopened:true,keisenProof:{version,textVerified,cellGetterMode:'normal-editing',passed:true,reopened:true,
    checks:spec.keisenOperations.map((op,i)=>({stage:`step-${i+1}`,passed:true}))}};
   for(const phase of ['before-save','reopened'])await saveMacroEvidence(sample,{label:phase,phase,observed:{settings:spec.settings},verification,macroSource:'end\r\n',resultBytes:Buffer.from('synthetic','utf16le')});
   await finalizeSample(sample,{verification});
  }
  const catalog=await buildMacroCatalog({helpDirectory,runDirectories:[run.dir]});
  assert.equal(catalog.capabilities.find(c=>c.id==='keisen-table').stages.runtimeApplied,accepted);
  const observe=()=>observeRun(run.dir,{outputDirectory:path.join(root,`analysis-${version}-${textVerified}`),referenceId:'one-cell'});
  if(accepted)assert.equal((await observe()).samples,2);else await assert.rejects(observe);
 }
});

test('paragraph association retains target identity and full operation history in repeat recipes',async t=>{
 const root=await fixture(t),recipe=JSON.parse(await fs.readFile(new URL('../examples/paragraph-attributes.json',import.meta.url)));
 recipe.samples=recipe.samples.slice(0,2);const plan=expandExperiment(recipe),run=await createRun({outputRoot:root,experiment:plan});
 for(const spec of plan.samples){
  const sample=await startSample(run,{id:spec.id,requested:{paragraphTargets:plan.paragraphTargets,paragraphOperations:spec.paragraphOperations}});await fs.writeFile(sample.documentPath,compound());
  const verification={method:'macro-getter',passed:true,reopened:true,paragraphProof:{version:1,passed:true,reopened:true,checks:spec.paragraphOperations.map((operation,i)=>({stage:`step-${i+1}`,operation,passed:true}))}};
  for(const phase of ['before-save','reopened'])await saveMacroEvidence(sample,{label:phase,phase,observed:{settings:spec.settings},verification,macroSource:'end\r\n',resultBytes:Buffer.from('synthetic paragraph','utf16le')});
  await finalizeSample(sample,{verification});
 }
 const result=await observeRun(run.dir,{outputDirectory:path.join(root,'analysis'),referenceId:'alignment-change'});
 const next=JSON.parse(await fs.readFile(result.nextRecipe,'utf8'));expandExperiment(next);
 assert.deepEqual(next.paragraphTargets,recipe.paragraphTargets);
 for(const s of next.samples.slice(0,2))assert.deepEqual(s.paragraphOperations,recipe.samples[1].paragraphOperations);
});
