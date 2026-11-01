import { supportsTableProof } from './keisen-structured.mjs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { verifyRun } from './evidence.mjs';
import { readCfb, physicalSpans } from './cfb.mjs';
import { diffBytes, digest, hexOffset } from './binary-diff.mjs';
import { validateExperiment, STYLE_FIELDS } from './experiment.mjs';
import { FEATURE_GROUPS } from './features.mjs';

const MAX_FILE=16*1024*1024, MAX_RUN=128*1024*1024;
const empty=Buffer.alloc(0), json=v=>JSON.stringify(v,null,2)+'\n';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function newOutputDirectory(out,protectedRoots=[]){
  const isInside=(root,target)=>{const relative=path.relative(root,target);return relative===''||(!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative));};
  // Reject aliases instead of resolving them: native realpath is unavailable
  // in some Windows sandboxes, and output must not enter an evidence junction.
  for(const start of [path.dirname(out),...protectedRoots]){
    let cursor=path.resolve(start);
    for(;;){
      try{check(!(await fs.lstat(cursor)).isSymbolicLink(),'Output/evidence directory cannot use symlinks or junctions.');}catch(e){if(e.code!=='ENOENT')throw e;}
      const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;
    }
  }
  for(const root of protectedRoots)check(!isInside(path.resolve(root),out),'Output must be outside the evidence run.');
  await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out);
}
function flatten(obj,prefix='',result={}){
  for(const key of Object.keys(obj??{}).sort()){
    if(key==='fullName')continue;
    const name=prefix?prefix+'.'+key:key,value=obj[key];
    if(value!==null&&typeof value==='object')flatten(value,name,result);else result[name]=value;
  }
  return result;
}
async function boundedRead(filename){
  const s=await fs.stat(filename);check(s.isFile()&&s.size<=MAX_FILE,'Input exceeds 16 MiB or is not a file.');
  const b=await fs.readFile(filename);check(b.length<=MAX_FILE,'Input grew past limit.');return b;
}
export function compareDocuments(a,b){
  const raw=diffBytes(a.bytes,b.bytes),streams=[];
  if(a.cfb&&b.cfb){
    const keys=[...new Set([...a.cfb.streams.keys(),...b.cfb.streams.keys()])].sort();
    for(const key of keys){
      const left=a.cfb.streams.get(key),right=b.cfb.streams.get(key),diff=diffBytes(left?.bytes??empty,right?.bytes??empty);
      if(!diff.changedBytes&&left&&right)continue;
      for(const r of diff.ranges){
        r.beforePhysical=left?physicalSpans(left,r.offset,r.beforeLength):[];
        r.afterPhysical=right?physicalSpans(right,r.offset,r.afterLength):[];
      }
      streams.push({key,path:(left??right).path,status:!left?'added':!right?'removed':'changed',...diff});
    }
  }
  return {raw,streams,streamComparison:!!(a.cfb&&b.cfb)};
}

/** Associations of observed values with bytes. No claims of field decoding. */
export function findAssociations(samples,{maxCandidates=256,maxPositions=200000}={}){
  if(samples.length<2||samples.some(s=>!s.cfb))return {candidates:[],excludedStreams:[],scannedPositions:0,omittedPositions:0,variableWithinReplicates:0};
  const groups=new Map();
  for(const s of samples){const key=JSON.stringify(s.observed);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s);}
  const fields=Object.keys(samples[0].observed).filter(f=>f!=='body'&&samples.every(s=>Object.hasOwn(s.observed,f))&&new Set(samples.map(s=>JSON.stringify(s.observed[f]))).size>1);
  const fieldGroups=fields.map(field=>{
    const values=new Map();for(let i=0;i<samples.length;i++){const v=JSON.stringify(samples[i].observed[field]);if(!values.has(v))values.set(v,[]);values.get(v).push(i);}
    return {field,values:[...values.values()]};
  });
  const candidates=[],excludedStreams=[],variableRegions=[];let scannedPositions=0,omittedPositions=0,variableWithinReplicates=0,omittedCandidates=0,omittedVariablePositions=0;
  const keys=[...new Set(samples.flatMap(s=>[...s.cfb.streams.keys()]))].sort();
  for(const key of keys){
    const streams=samples.map(s=>s.cfb.streams.get(key));
    if(streams.some(s=>!s)||new Set(streams.map(s=>s.bytes.length)).size>1){excludedStreams.push({key,reason:'missing or unequal length; positional association suppressed'});continue;}
    const length=streams[0].bytes.length;
    for(let offset=0;offset<length;offset++){
      const values=streams.map(s=>s.bytes[offset]);if(values.every(v=>v===values[0]))continue;
      if(scannedPositions>=maxPositions){omittedPositions++;continue;}scannedPositions++;
      const variable=[...groups.values()].some(g=>new Set(g.map(s=>s.cfb.streams.get(key).bytes[offset])).size>1);
      if(variable){
        variableWithinReplicates++;
        const previous=variableRegions.at(-1);
        if(previous&&previous.key===key&&previous.offset+previous.length===offset&&previous.length<32){
          previous.length++;previous.values.forEach((v,i)=>{v.hex+=values[i].toString(16).padStart(2,'0');});
        }else if(variableRegions.length<256)variableRegions.push({key,path:streams[0].path,offset,offsetHex:hexOffset(offset),length:1,values:samples.map((s,i)=>({sampleId:s.id,hex:values[i].toString(16).padStart(2,'0')}))});
        else omittedVariablePositions++;
        continue;
      }
      const matches=fieldGroups.filter(f=>f.values.every(ids=>ids.every(i=>values[i]===values[ids[0]])));
      if(!matches.length)continue;
      const fieldNames=matches.map(f=>f.field);
      const previous=candidates.at(-1);
      if(previous&&previous.key===key&&previous.offset+previous.length===offset&&previous.length<32&&equal(previous.fields,fieldNames)){
        previous.length++;previous.values.forEach((v,i)=>{v.hex+=values[i].toString(16).padStart(2,'0');});continue;
      }
      if(candidates.length>=maxCandidates){omittedCandidates++;continue;}
      candidates.push({key,path:streams[0].path,offset,offsetHex:hexOffset(offset),length:1,fields:fieldNames,
        repeatedObservationGroups:[...groups.values()].filter(g=>g.length>=2).length,
        values:samples.map((s,i)=>({sampleId:s.id,hex:values[i].toString(16).padStart(2,'0'),observed:Object.fromEntries(fieldNames.map(f=>[f,s.observed[f]]))})),
        interpretation:'hypothesis only; correlated settings and hidden state can explain the same bytes'});
    }
  }
  return {candidates,excludedStreams,scannedPositions,omittedPositions,omittedCandidates,variableWithinReplicates,variableRegions,omittedVariablePositions,
    repeatedObservationGroups:[...groups.values()].filter(g=>g.length>=2).map(g=>g.map(s=>s.id))};
}

function proposals(metadata,samples,associations,reference){
  const recipe=metadata.experiment;
  if(!recipe?.defaults||typeof recipe.text!=='string')return {recipe:null,reasons:['Source recipe unavailable.']};
  if(recipe.keisenCanvas||recipe.paragraphTargets||recipe.samples?.some(s=>s.footnote!==undefined||s.namedStyle!==undefined||s.documentColumns!==undefined||s.headerSteps!==undefined)){
    // Repeat the actual compared condition, including its table and cell edits.
    // Empty operations would silently replace a table control with a blank page.
    const source=id=>(recipe.samples??[]).find(s=>s.id===id);
    const copy=s=>Object.fromEntries(['settings','features','layoutPriority','keisenOperations','paragraphOperations','documentColumns','headerSteps','headerPosition','headerPages','namedStyle','footnote'].filter(k=>s[k]!==undefined&&!((s.footnote!==undefined||s.namedStyle!==undefined||s.documentColumns!==undefined||s.headerSteps!==undefined)&&['features','layoutPriority'].includes(k))).map(k=>[k,structuredClone(s[k])]));
    const base=source(reference.id);if(!base)return {recipe:null,reasons:['Reference recipe unavailable.']};
    const proposed=[1,2].map(n=>({id:`control-${n}`,...copy(base)}));
    const reasons=[{sampleIds:['control-1','control-2'],sourceSample:reference.id,reason:'Repeat the actual reference settings and ruled-line operations, including table/cell or paragraph scope.'}];
    const variant=samples.find(s=>s.id!==reference.id&&source(s.id)&&!equal(copy(source(s.id)),copy(base)));
    if(variant){proposed.push(...[1,2].map(n=>({id:`variant-${n}`,...copy(source(variant.id))})));reasons.push({sampleIds:['variant-1','variant-2'],sourceSample:variant.id,reason:'Repeat one different recipe condition to distinguish within-condition variation from a reproducible difference; not a causal claim.'});}
    return {recipe:validateExperiment({schemaVersion:1,name:'next-structure-replicates',defaults:recipe.defaults,text:recipe.text,...(recipe.keisenCanvas?{keisenCanvas:recipe.keisenCanvas}:{}),...(recipe.paragraphTargets?{paragraphTargets:recipe.paragraphTargets}:{}),samples:proposed}),reasons};
  }
  const proposed=[{id:'control-1',settings:{}},{id:'control-2',settings:{}}],reasons=[{sampleIds:['control-1','control-2'],reason:'Repeat unchanged saves to measure variability in the next run; baseline conditions must be checked again.'}];
  const fields=[...new Set(associations.candidates.flatMap(c=>c.fields))];
  for(const field of fields){
    if(proposed.length>=7)break;
    const values=[...new Set(samples.map(s=>s.observed[field]))];
    if(!values.every(v=>typeof v==='number'&&Number.isFinite(v)))continue;
    values.sort((a,b)=>a-b);
    const parts=field.split('.'),isSetting=parts[0]==='settings'&&STYLE_FIELDS.includes(parts[1]);
    const def=parts[0]==='features'?FEATURE_GROUPS[parts[1]]?.fields[parts[2]]:null;
    if(!isSetting&&!def)continue;
    let value=def?.values?.find(v=>!values.includes(v));
    if(!def?.values){
      value=Math.round((values[0]+values.at(-1))/2);
      if(values.includes(value))value=values.at(-1)+1;
    }
    if(value===undefined)continue;
    const sample={id:`probe-${proposed.length-1}`,settings:{}};
    if(isSetting){sample.settings[parts[1]]=value;if(['characterSpacing','lineSpacing'].includes(parts[1]))sample.layoutPriority='spacing';}
    else sample.features={[parts[1]]:{[parts[2]]:value}};
    try{validateExperiment({schemaVersion:1,name:'next-probes',defaults:recipe.defaults,text:recipe.text,samples:[sample]});}catch{continue;}
    proposed.push(sample);
    reasons.push({sampleId:sample.id,field,value,reason:'Untested numeric value to challenge the byte association; inspect coupled getter changes. Acceptance by Ichitaro is not guaranteed.'});
  }
  return {recipe:validateExperiment({schemaVersion:1,name:'next-probes',defaults:recipe.defaults,text:recipe.text,samples:proposed,...(recipe.targets?{targets:recipe.targets}:{}),...(recipe.keisenCanvas?{keisenCanvas:recipe.keisenCanvas}:{})}),reasons};
}

export async function observeRun(runDirectory,{outputDirectory,referenceId}={}){
  const root=path.resolve(runDirectory),integrity=await verifyRun(root);
  check(integrity.ok,'Run integrity verification failed: '+JSON.stringify(integrity.errors));
  const index=JSON.parse(await fs.readFile(path.join(root,'index.json'),'utf8')),metadata=JSON.parse(await fs.readFile(path.join(root,'run.json'),'utf8'));
  check(index.samples.length>=2&&index.samples.length<=200,'Observation requires 2..200 completed samples.');
  const samples=[];let total=0;
  for(const record of index.samples){
    const manifestBytes=await fs.readFile(path.join(root,record.manifest.path));
    check(digest(manifestBytes)===record.manifest.sha256,'Manifest changed during observation.');
    const m=JSON.parse(manifestBytes);check(m.status==='verified'&&m.verification?.passed,'Only verified samples may be associated with settings.');
    if(m.requested?.keisenOperations?.some(op=>op.type!=='line'))check(supportsTableProof(m.requested.keisenOperations,m.verification.keisenProof),'Legacy drawing-mode table getters are superseded; regenerate this run with normal-editing cell getters before association.');
    if(m.requested?.footnote)check(m.verification.footnoteProof?.version===(m.requested.footnote.steps?2:1)&&m.verification.footnoteProof.passed&&m.verification.footnoteProof.reopened&&JSON.stringify(m.verification.footnoteProof.trial)===JSON.stringify(m.requested.footnote),'Footnote association requires matching proof.');
    if(m.requested?.namedStyle)check(m.verification.namedStyleProof?.version===1&&m.verification.namedStyleProof.passed&&m.verification.namedStyleProof.reopened&&JSON.stringify(m.verification.namedStyleProof.trial)===JSON.stringify(m.requested.namedStyle),'Named style association requires matching proof.');
    if(m.requested?.headerSteps!==undefined)check(((m.verification.headerProof?.version===1&&(m.requested.headerPages??1)===1&&(m.requested.headerPosition??1)===1)||(((m.verification.headerProof?.version===2&&(m.requested.headerPages??1)===1)||(m.verification.headerProof?.version===3&&m.verification.headerProof.pages===(m.requested.headerPages??1)))&&m.verification.headerProof.position===(m.requested.headerPosition??1)))&&m.verification.headerProof.passed&&m.verification.headerProof.reopened&&JSON.stringify(m.verification.headerProof.steps)===JSON.stringify(m.requested.headerSteps),'Header association requires exact structural proof.');
    if(m.requested?.documentColumns!==undefined)check(m.verification.columnProof?.version===1&&m.verification.columnProof.passed&&m.verification.columnProof.reopened&&JSON.stringify(m.verification.columnProof.steps)===JSON.stringify(m.requested.documentColumns),'Column association requires exact structural proof.');
    if(m.requested?.paragraphTargets)check([1,2].includes(m.verification.paragraphProof?.version)&&(!m.requested.paragraphOperations?.some(op=>op.attribute==='tabs')||(m.verification.paragraphProof.version===2&&m.verification.paragraphProof.characterIdentityVerified===true))&&m.verification.paragraphProof.passed&&m.verification.paragraphProof.reopened,'Paragraph association requires verified paragraph getter evidence.');
    const filename=path.join(root,'samples',m.id,'document.jtd'),bytes=await boundedRead(filename);total+=bytes.length;
    check(total<=MAX_RUN,'Run exceeds 128 MiB observation limit.');check(digest(bytes)===m.document.sha256,'JTD changed during observation.');
    samples.push({id:m.id,filename,bytes,cfb:readCfb(bytes),observed:flatten(m.observed),requested:m.requested,rangeProof:m.verification.rangeProof,keisenProof:m.verification.keisenProof,paragraphProof:m.verification.paragraphProof,columnProof:m.verification.columnProof,headerProof:m.verification.headerProof,footnoteProof:m.verification.footnoteProof,namedStyleProof:m.verification.namedStyleProof,bodyComparison:m.verification.bodyComparison,sha256:digest(bytes),manifestSha256:digest(manifestBytes)});
  }
  const baseline=samples.find(s=>s.id==='baseline');check(baseline,'Run needs a baseline sample.');
  // A re-saved control is preferable to a newly created baseline for content
  // hypotheses: saving alone can add whole streams. Equality is scoped to getters.
  const controls=samples.filter(s=>s!==baseline&&equal(s.observed,baseline.observed));
  const reference=referenceId?samples.find(s=>s.id===referenceId):controls.find(s=>/^control-/.test(s.id))??controls[0]??baseline;
  check(reference,'Unknown reference sample.');
  const cohort=reference===baseline?samples:samples.filter(s=>s!==baseline);
  const associations=findAssociations(cohort),next=proposals(metadata,cohort,associations,reference);
  const out=path.resolve(outputDirectory??path.join('observations',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)));
  const relative=path.relative(root,out);check(relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'Output must be outside the evidence run.');
  await newOutputDirectory(out,[root]);await fs.mkdir(path.join(out,'pairs'));
  const comparisons=[];
  for(const s of samples){
    if(s===reference)continue;
    const detail={before:reference.id,after:s.id,observedChanges:Object.keys({...reference.observed,...s.observed}).filter(f=>!equal(reference.observed[f],s.observed[f])).map(field=>({field,before:reference.observed[field],after:s.observed[field]})),...compareDocuments(reference,s)};
    const file=`pairs/${s.id}.json`;await fs.writeFile(path.join(out,file),json(detail),{flag:'wx'});
    comparisons.push({sampleId:s.id,detail:file,rawChangedBytes:detail.raw.changedBytes,changedStreams:detail.streams.map(x=>({key:x.key,changedBytes:x.changedBytes,sizeDelta:x.sizeDelta})),observedChanges:detail.observedChanges});
  }
  const result={schemaVersion:1,analyzerVersion:'0.5.0',runDirectory:root,reference:reference.id,baseline:baseline.id,
    referenceReason:referenceId?'explicit':reference!==baseline?'re-saved sample with equal observed settings/body':'no re-saved observed-equal control available',
    associationCohort:cohort.map(s=>s.id),controlCandidates:controls.map(s=>s.id),
    sources:samples.map(s=>({id:s.id,path:s.filename,sha256:s.sha256,manifestSha256:s.manifestSha256,bytes:s.bytes.length,cfb:!!s.cfb,requested:s.requested,observed:s.observed,rangeProof:s.rangeProof,keisenProof:s.keisenProof,paragraphProof:s.paragraphProof,columnProof:s.columnProof,headerProof:s.headerProof,footnoteProof:s.footnoteProof,namedStyleProof:s.namedStyleProof,bodyComparison:s.bodyComparison})),comparisons,associations,
    nextProbes:{recipe:next.recipe?'next-probes.json':null,reasons:next.reasons},
    limitations:['Offsets are positional, not insertion/deletion alignment. Unequal-sized or missing streams are excluded from associations.',
      'Equal observations cover recorded getters/body only. No control mask proves that remaining bytes encode a setting.',
      'Groups use equal observations, not identical operation histories. History-dependent bytes can be excluded as within-group variation; use exact-recipe replicates to distinguish these effects.',
      'Association is not causation or a decoded JTD field. All co-varying settings remain possible explanations.',
      'Byte previews and candidate counts are bounded; omitted counts are explicit. Use slice to inspect exact bytes.',
      ...(samples.some(s=>s.keisenProof)?['罫線は限定グリッド内とセルの代表点を照合しています。空白本文の長さや配置は保持を要求しないため、本文の変動も差分の原因になり得ます。sources.keisenProof と bodyComparison を参照してください。']:[]),
      ...(samples.some(s=>s.rangeProof?.checks.some(c=>c.widthVerified===false))?['均等幅は未検証です。同じ有無を返す異なる幅の試料も観測値が等しい群に入り得るため、幅に対応する差分を反復内変動として除外する可能性があります。指定幅の因果関係は推定しません。']:[]),
      ...(samples.some(s=>s.rangeProof?.getterDisagreements?.length)?['専用getterと文字情報getterに不一致があります。両方の観測値と検証範囲をsources.rangeProofに保存しています。']:[])]};
  await fs.writeFile(path.join(out,'observation.json'),json(result),{flag:'wx'});
  if(next.recipe)await fs.writeFile(path.join(out,'next-probes.json'),json(next.recipe),{flag:'wx'});
  const summary={outputDirectory:out,reference:reference.id,samples:samples.length,comparisons:comparisons.length,candidateRegions:associations.candidates.length,
    variableWithinReplicates:associations.variableWithinReplicates,excludedStreams:associations.excludedStreams.length,omittedCandidatePositions:associations.omittedCandidates??0,omittedScanPositions:associations.omittedPositions,
    topCandidates:associations.candidates.slice(0,12).map(c=>({stream:c.path,offsetHex:c.offsetHex,length:c.length,byteValues:[...new Set(c.values.map(v=>v.hex))].slice(0,8),fields:c.fields,repeatedObservationGroups:c.repeatedObservationGroups})),
    details:path.join(out,'observation.json'),report:path.join(out,'index.html'),nextRecipe:next.recipe?path.join(out,'next-probes.json'):null};
  await fs.writeFile(path.join(out,'summary.json'),json(summary),{flag:'wx'});
  const rows=associations.candidates.map(c=>`<tr><td>${escape(JSON.stringify(c.path))}</td><td>${c.offsetHex} +${c.length}</td><td>${escape(c.fields.join('\n'))}</td><td>${escape(c.values.map(v=>v.sampleId+': '+v.hex).join('\n'))}</td></tr>`).join('');
  await fs.writeFile(path.join(out,'index.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>JTD差分観測</title><style>body{font:15px system-ui;margin:2rem}table{border-collapse:collapse}td,th{border:1px solid #ccd;padding:.6rem;text-align:left;white-space:pre-wrap;vertical-align:top}code{overflow-wrap:anywhere}</style><h1>JTD差分観測</h1><p>比較基準: ${escape(reference.id)} / ${samples.length}試料。以下は対応候補であり、形式の解読結果ではありません。</p><p><a href="observation.json">全観測JSON</a> · <a href="summary.json">要約JSON</a>${next.recipe?' · <a href="next-probes.json">次の検証レシピ（未実行）</a>':''}</p><ul>${result.limitations.map(s=>`<li>${escape(s)}</li>`).join('')}</ul><h2>試料ごとの差分</h2><ul>${comparisons.map(c=>`<li><a href="${c.detail}">${escape(c.sampleId)}</a>: 物理位置で${c.rawChangedBytes}バイト変更、${c.changedStreams.length}ストリーム変更</li>`).join('')}</ul><h2>観測値と連動した領域</h2><p>反復内で変動した位置: ${associations.variableWithinReplicates} / 長さ等により候補計算から除外: ${associations.excludedStreams.length}ストリーム。候補上限による省略: ${associations.omittedCandidates??0}位置、走査上限による省略: ${associations.omittedPositions}位置。</p><table><tr><th>ストリーム</th><th>論理位置 / 長さ</th><th>連動した観測値</th><th>バイト列</th></tr>${rows}</table></html>`,{flag:'wx'});
  return summary;
}

/** Two-file inspection also supports files outside managed/verified runs. */
export async function observePair(beforeFile,afterFile,outputDirectory){
  check(typeof outputDirectory==='string','pair requires a new output directory.');
  const before=await boundedRead(beforeFile),after=await boundedRead(afterFile);
  const result={schemaVersion:1,before:{path:path.resolve(beforeFile),bytes:before.length,sha256:digest(before)},after:{path:path.resolve(afterFile),bytes:after.length,sha256:digest(after)},
    provenance:'Unmanaged pair; settings and evidence manifests are not verified.',...compareDocuments({bytes:before,cfb:readCfb(before)},{bytes:after,cfb:readCfb(after)})};
  const out=path.resolve(outputDirectory);await newOutputDirectory(out);
  await fs.writeFile(path.join(out,'pair.json'),json(result),{flag:'wx'});
  return {outputDirectory:out,details:path.join(out,'pair.json'),rawChangedBytes:result.raw.changedBytes,changedStreams:result.streams.length,streamComparison:result.streamComparison};
}

export async function inspectBytes(filename,{offset,length=64,stream}={}){
  check(Number.isSafeInteger(offset)&&offset>=0&&Number.isInteger(length)&&length>=1&&length<=4096,'slice requires offset >= 0 and length 1..4096.');
  const bytes=await boundedRead(filename),cfb=stream?readCfb(bytes):null;
  const target=stream?cfb?.streams.get(JSON.stringify(stream)):null;
  check(!stream||target,'Stream path not found. Pass a JSON array of exact path components.');
  const data=target?.bytes??bytes;check(offset+length<=data.length,'Requested slice exceeds data.');
  return {path:path.resolve(filename),sha256:digest(bytes),stream:stream??null,offset,offsetHex:hexOffset(offset),length,hex:data.subarray(offset,offset+length).toString('hex'),physical:target?physicalSpans(target,offset,length):[{offset,fileOffset:offset,length}]};
}

