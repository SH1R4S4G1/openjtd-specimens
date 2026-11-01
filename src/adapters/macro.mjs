import { footnoteMacro, verifyFootnote, footnoteBody } from '../footnotes.mjs';
import { namedStyleMacro, verifyNamedStyle } from '../named-styles.mjs';
import { headerMacro, verifyHeader } from '../headers.mjs';
import { columnsMacro, verifyColumns } from '../document-columns.mjs';
import { framesMacro, verifyFrames } from '../frames.mjs';
import { headerLayoutMacro, verifyHeaderLayout } from '../header-layout.mjs';
import { styleDefinitionsMacro, verifyStyleDefinitions } from '../style-definitions.mjs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { STYLE_FIELDS } from '../experiment.mjs';
import { pdfPageCount } from '../pdf-pages.mjs';
import { readFileRetry, isSharingViolation } from '../file-retry.mjs';
import { bodyParagraphsMacro, verifyBodyParagraphs } from '../body-paragraphs.mjs';
import { FEATURE_GROUPS, validateFeatures } from '../features.mjs';
import { validateTargets, validateOperations, rangeMacro, verifyRangeReadback } from '../ranges.mjs';
import { paragraphMacro, verifyParagraphReadback } from '../paragraphs.mjs';
import { validateKeisenCanvas, validateKeisenOperations, keisenMacro, verifyKeisenReadback } from '../keisen.mjs';

export const DEFAULT_EXE='C:/Program Files (x86)/JustSystems/TARO36/taro36.exe';
// The one place that decides which Ichitaro runs: --exe (the caller passes it),
// then ICHITARO_EXE, then DEFAULT_EXE. The lock path is derived from it, so every
// command that starts Ichitaro, records its build or reads its lock must use it.
export function resolveIchitaroExe(exe,env=process.env){return path.resolve(exe??(env.ICHITARO_EXE||DEFAULT_EXE));}
// --allow-running-ichitaro (the caller passes true) or ICHITARO_ALLOW_RUNNING=1 allows it.
export function allowRunningIchitaro(flag,env=process.env){return flag??env.ICHITARO_ALLOW_RUNNING==='1';}
const LAYOUT={chars:'字数',lines:'行数',characterSpacing:'字間',lineSpacing:'行間',spacingUnit:'字間行間単位',orientation:'文字組',priority:'字数行数優先'};
const MARGIN={marginTop:'上マージン',marginBottom:'下マージン',marginLeft:'左マージン',marginRight:'右マージン',marginUnit:'マージン単位'};
const NUMBERS=[...Object.keys(LAYOUT),...Object.keys(MARGIN)];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function insist(ok,message){if(!ok)throw new Error(message);}
// Waits that leave out the time the computer slept (0.20.1). Every poll pauses
// 100..250ms; more than SLEEP_GAP_MS between two polls (or the clock going back)
// means this process was suspended, and that gap is not counted against the limit
// (Ichitaro was suspended too and carries on after waking). The adapter keeps the
// excluded time (suspendedMs) for the evidence.
export const SLEEP_GAP_MS=10000;
export function awakeTimer(started,{now=Date.now,gapMs=SLEEP_GAP_MS}={}){
  let last=started,elapsed=0,suspended=0;
  return {elapsed(){const t=now(),gap=t-last;last=t;if(gap<0||gap>gapMs)suspended+=Math.max(0,gap);else elapsed+=gap;return elapsed;},get suspendedMs(){return suspended;}};
}

// Sprint uses doubled quotes, literal backslashes, and Char(code,5) for Unicode.
// Emit ASCII source so macro-file encoding cannot alter Japanese keys or text.
export function macroString(value) {
  insist(typeof value==='string'&&!/[\u0000\uD800-\uDFFF]/.test(value),'Macro strings support BMP Unicode without NUL or surrogate code units.');
  const parts=[];let literal='';
  const flush=()=>{if(literal){parts.push('"'+literal.replaceAll('"','""')+'"');literal='';}};
  for(const char of value){const n=char.charCodeAt(0);if(n>=32&&n<=126)literal+=char;else{flush();parts.push(`Char(${n},5)`);}}
  flush();return parts.join(' & ')||'""';
}
function literalPath(value){insist(typeof value==='string'&&path.isAbsolute(value)&&!/[\r\n\0]/.test(value),'Expected an absolute local path.');return macroString(value);}
function validateSettings(settings){
  insist(settings&&Object.getPrototypeOf(settings)===Object.prototype,'Settings must be a plain object.');
  for(const [key,value] of Object.entries(settings))insist(STYLE_FIELDS.includes(key)&&Number.isFinite(value)&&Math.abs(value)<=10000&&(key!=='lines'||Number.isInteger(value)),'Invalid numeric style setting: '+key);
}
const get=(name,key)=>`%${name}(${macroString(key)})`;
function featureSnapshot(){
  const lines=[];
  for(const [group,def] of Object.entries(FEATURE_GROUPS)) {
    if(def.getter)lines.push(`%feature=${def.getter}()`);
    for(const [field,info] of Object.entries(def.fields))lines.push(`%result.LinePrint("feature.${group}.${field}=" & ${group==='layout'?get('layout',info.jp):def.scalar?'%feature':get('feature',info.jp)})`);
  }
  return lines;
}
function featureSetters(features){
  const lines=[];
  // Apply paper/font first: both can affect the later layout values.
  for(const group of ['paper','font','columns','page','typesetting','layout']){
    const values=features[group];if(!values||!Object.keys(values).length)continue;
    if(group==='layout')lines.push(`DocumentStyleLayout(,,,,,${values.orientation})`);
    else{
      const def=FEATURE_GROUPS[group];
      const args=Object.keys(def.fields).map(key=>!Object.hasOwn(values,key)?'':typeof values[key]==='string'?macroString(values[key]):String(values[key]));
      while(args.at(-1)==='')args.pop();
      lines.push(`${def.setter}(${args.join(',')})`);
    }
    lines.push('SetDocumentStyle()');
  }
  return lines;
}
function snapshot(phase,captureFeatures){return [
  `%result.LinePrint("[${phase}]")`,'%layout=GetDocumentStyleLayout()','%margin=GetDocumentStyleMargin()',
  ...Object.entries(LAYOUT).map(([key,jp])=>`%result.LinePrint("${key}=" & ${get('layout',jp)})`),
  ...Object.entries(MARGIN).map(([key,jp])=>`%result.LinePrint("${key}=" & ${get('margin',jp)})`),
  'set %doc=Application.ActiveDocument','%result.LinePrint("fullName=" & %doc.FullName)',
  ...(captureFeatures?featureSnapshot():[]),
];}
function setters(settings,layoutPriority){
  const lines=['%layout=GetDocumentStyleLayout()','%margin=GetDocumentStyleMargin()'];
  // Margins and counts constrain each other: Ichitaro shrinks margins that
  // cannot hold the current character count (e.g. after a smaller paper).
  // A second guarded pass re-applies only values that still differ.
  const groups=[['margin',Object.keys(MARGIN).slice(0,4),'DocumentStyleMargin'],['layout',Object.keys(LAYOUT).slice(0,4),'DocumentStyleLayout']];
  for(const [group,fields,fn] of [...groups,...groups]){
    if(group==='margin')lines.push('%margin=GetDocumentStyleMargin()');
    const selected=fields.filter(k=>Object.hasOwn(settings,k));
    const priority=group==='layout'&&layoutPriority!=='preserve'?(layoutPriority==='counts'?1:0):null;
    if(!selected.length&&priority===null)continue;
    const keys=group==='margin'?MARGIN:LAYOUT;
    if(group==='layout')lines.push('%layout=GetDocumentStyleLayout()');
    const conditions=selected.map(k=>`${get(group,keys[k])} <> ${settings[k]}`);
    if(priority!==null)conditions.push(`${get('layout',LAYOUT.priority)} <> ${priority}`);
    lines.push('if '+conditions.join(' or ')+' then');
    // Unspecified values are omitted, preserving one-factor experiments.
    const args=fields.map(k=>Object.hasOwn(settings,k)?settings[k]:'');
    if(priority!==null)args.push('','',priority);
    lines.push(fn+'('+args.join(',')+')','SetDocumentStyle()','end if');
  }
  return lines;
}

/** Fixed operations only; callers cannot supply macro statements or function names. */
export function compileSample({nonce,bodyParagraphs=false,input=null,output,text,settings,layoutPriority='preserve',features={},captureFeatures=false,targets,operations=[],keisenCanvas,keisenOperations=[],paragraphTargets,paragraphOperations=[],footnote,namedStyle,headerSteps,headerPosition,headerPages,documentColumns,frames,headerLayout,namedStyles,columnRange,resultPath,bodyPath,donePath}){
  features=validateFeatures(features);captureFeatures=captureFeatures||Object.keys(features).length>0;
  insist(/^[a-f0-9-]{36}$/.test(nonce),'Invalid job nonce.');validateSettings(settings);
  insist(['preserve','counts','spacing'].includes(layoutPriority),'Invalid layoutPriority.');
  const outputCode=literalPath(output);literalPath(resultPath);literalPath(bodyPath);literalPath(donePath);
  insist(typeof text==='string'&&text.length<=100000,'Sample text must be at most 100000 UTF-16 units.');macroString(text);
  const note=footnote?footnoteMacro({text,trial:footnote,q:macroString}):null;
  insist(!note||(!namedStyle&&!paragraphTargets&&!targets&&!keisenCanvas&&documentColumns===undefined&&frames===undefined&&(headerPages??1)===1&&features.layout?.orientation!==2),'Footnotes combine only with a one-page header/footer (horizontal)');
  const named=namedStyle?namedStyleMacro({text,trial:namedStyle,q:macroString}):null;
  insist(!named||(!paragraphTargets&&!targets&&!keisenCanvas&&documentColumns===undefined&&headerSteps===undefined&&features.layout?.orientation!==2),'Named styles require isolated horizontal trial');
  const header=headerSteps!==undefined?headerMacro({text,pages:headerPages,position:headerPosition,steps:headerSteps,q:macroString}):null;
  insist(!header||(!targets&&!keisenCanvas&&features.layout?.orientation!==2),'Header trials cannot mix with ranges, tables or vertical writing');
  const columns=documentColumns!==undefined?columnsMacro({text,steps:documentColumns,q:macroString,range:columnRange}):null;
  insist(!columns||(!targets&&!keisenCanvas&&features.layout?.orientation!==2),'Columns trials cannot mix with ranges, tables or vertical writing');
  const frame=frames!==undefined?framesMacro({text,frames,q:macroString}):null;
  insist(!frame||(!note&&!named&&!targets&&!keisenCanvas&&features.layout?.orientation!==2),'Frame trials cannot mix with footnotes, named styles, ranges, tables or vertical writing');
  const layoutHeader=headerLayout!==undefined?headerLayoutMacro({text,layout:headerLayout,q:macroString}):null;
  insist(!layoutHeader||(!note&&!named&&!header&&!columns&&!frame&&!paragraphTargets&&!targets&&!keisenCanvas&&features.layout?.orientation!==2),'Header layout trials are isolated and horizontal');
  const styles=namedStyles!==undefined?styleDefinitionsMacro({text,trial:namedStyles,q:macroString}):null;
  insist(!styles||(!note&&!named&&!header&&!columns&&!frame&&!layoutHeader&&!paragraphTargets&&!targets&&!keisenCanvas&&features.layout?.orientation!==2),'Style definition trials are isolated and horizontal');
  const paragraph=paragraphTargets?paragraphMacro({text,targets:paragraphTargets,operations:paragraphOperations,q:macroString}):null;
  insist(paragraph||paragraphOperations.length===0,'Paragraph operations require targets.');
  insist(!paragraph||(!targets&&!keisenCanvas&&features.layout?.orientation!==2),'Paragraph trials cannot mix with ranges, tables or vertical writing.');
  const walk=bodyParagraphs?bodyParagraphsMacro({text,q:macroString}):null;
  insist(!walk||(!keisenCanvas&&!paragraphTargets&&!note&&!named&&!header&&!columns&&!frame&&!layoutHeader&&!styles&&features.layout?.orientation!==2),'A long body walk combines with horizontal text and text ranges only.');
  const range=targets?rangeMacro({text,targets:validateTargets(targets,text),operations:validateOperations(operations,targets),q:macroString}):null;
  insist(range||operations.length===0,'Operations require targets.');
  insist(!keisenCanvas||!range,'Keisen canvas and text ranges cannot be combined.');
  const keisen=keisenCanvas?keisenMacro({canvas:validateKeisenCanvas(keisenCanvas,text),operations:validateKeisenOperations(keisenOperations,keisenCanvas),q:macroString}):null;
  insist(keisen||keisenOperations.length===0,'Keisen operations require canvas.');
  insist(!keisen||features.layout?.orientation!==2,'Keisen requires horizontal writing.');
  insist(!range||features.layout?.orientation!==2,'Range execution currently requires horizontal writing.');
  const code=[`set %result=OpenFile(${literalPath(resultPath)},&H0106,1,5)`,
    `%result.LinePrint("nonce=${nonce}")`,...(captureFeatures?['%result.LinePrint("featuresVersion=1")']:[]),'%success=0','%phase="start"','try'];
  if(input)code.push('%phase="open-baseline"',`OpenDocumentFile(${literalPath(input)})`);
  else {
    code.push('%phase="new"','NewDocument()','%phase="insert"');
    const body=text.replace(/\r\n|\r/g,'\n');
    const pieces=headerPages===3||headerLayout?.even?body.split('\n'):paragraphTargets?body.split('\t'):[body];
    for(const [n,piece] of pieces.entries()){
      if(n)code.push(headerPages===3||headerLayout?.even?'InsertPage(1)':'Tab(1)');
      for(let i=0;i<piece.length;i+=80)code.push(`Insert(${macroString(piece.slice(i,i+80))})`);
    }
  }
  // Built as an array literal and appended in a loop: a long range readback has too
  // many lines to pass as spread call arguments.
  for(const line of ['%phase="features"',...featureSetters(features),'%phase="settings"',...setters(settings,layoutPriority),
    ...(range?['%rangeLayout=GetDocumentStyleLayout()',`if %rangeLayout(${macroString('文字組')}) = 1 then`,...range.apply,...range.snapshot('before-save'),'end if']:[]),
    ...(keisen?['%keisenLayout=GetDocumentStyleLayout()',`if %keisenLayout(${macroString('文字組')}) = 1 then`,...keisen.apply,...keisen.snapshot('before-save'),'end if']:[]),
    // Apply every structural element first and only then read each one back, so
    // a later element cannot silently change an earlier element's final state.
    ...(paragraph?['%paragraphLayout=GetDocumentStyleLayout()',`if %paragraphLayout(${macroString('文字組')}) = 1 then`,...paragraph.apply,'end if']:[]),
    ...(note?note.apply:[]),...(named?named.apply:[]),...(header?header.apply:[]),...(columns?columns.apply:[]),...(frame?frame.apply:[]),...(layoutHeader?layoutHeader.apply:[]),...(styles?styles.apply:[]),
    ...(paragraph?['%paragraphLayout=GetDocumentStyleLayout()',`if %paragraphLayout(${macroString('文字組')}) = 1 then`,...paragraph.snapshot('before-save'),'end if']:[]),
    ...(note?note.snapshot('before-save'):[]),...(named?named.snapshot('before-save'):[]),...(header?header.snapshot('before-save'):[]),...(columns?columns.snapshot('before-save'):[]),...(frame?frame.snapshot('before-save'):[]),...(layoutHeader?layoutHeader.snapshot('before-save'):[]),...(styles?styles.snapshot('before-save'):[]),
    ...(walk?['%phase="paragraph-walk"',...walk.snapshot('before-save')]:[]),
    ...snapshot('before-save',captureFeatures),'%phase="save"',
    `SaveDocument(${outputCode},"","",0)`,
    'set %doc=Application.ActiveDocument','%result.LinePrint("savedPath=" & %doc.FullName)',
    '%phase="close"','%doc.Close(3)','%phase="reopen"',`OpenDocumentFile(${outputCode})`,...(range?range.snapshot('reopened'):[]),...(keisen?keisen.snapshot('reopened'):[]),...(paragraph?paragraph.snapshot('reopened'):[]),...(columns?columns.snapshot('reopened'):[]),...(frame?frame.snapshot('reopened'):[]),...(layoutHeader?layoutHeader.snapshot('reopened'):[]),...(styles?styles.snapshot('reopened'):[]),...(header?header.snapshot('reopened'):[]),...(named?named.snapshot('reopened'):[]),...(note?note.snapshot('reopened'):[]),...(walk?walk.snapshot('reopened'):[]),...snapshot('reopened',captureFeatures),
    '%phase="body"','SelectAll(1)',`%body=GetString(${keisen?.bodyMethod??1})`,`set %bodyFile=OpenFile(${literalPath(bodyPath)},&H0106,1,5)`,
    'foreach %line in %body','%bodyFile.LinePrint(%line)','next','%bodyFile.Close()',
    'set %doc=Application.ActiveDocument','%doc.Close(3)','%result.LinePrint("status=ok")','%success=1',
    'exception','case else','set %err=MacroEngine.LastError','%result.LinePrint("status=error")',
    '%result.LinePrint("errorPhase=" & %phase)','%result.LinePrint("errorCode=" & %err.Code)',
    '%result.LinePrint("errorCategory=" & %err.Category)','%result.LinePrint("errorMessage=" & %err.Message)',
    '%result.LinePrint("errorLine=" & %err.Line)','end try','%result.Close()',
    `set %done=OpenFile(${literalPath(donePath)},&H0106,1,1)`,`%done.Write("${nonce}")`,'%done.Close()',
    // Quit without saving on success and on a reported macro error, so no unsaved
    // window is left for a later forced close (which leaves auto-backup prompts).
    'Application.Quit(3)','end'])code.push(line);
  return code.join('\r\n')+'\r\n';
}

export function decodeMacroText(bytes){
  insist(bytes.length%2===0,'Incomplete UTF-16 macro result.');
  return Buffer.from(bytes).toString('utf16le').replace(/^\uFEFF/,'');
}
export function parseMacroResult(bytes,nonce){
  const sections={};const meta={};let current=meta;
  for(const line of decodeMacroText(bytes).split(/\r?\n/)){
    if(!line)continue;
    if(/^\[(before-save|reopened)\]$/.test(line)){const phase=line.slice(1,-1);insist(!sections[phase],'Duplicate result phase.');current=sections[phase]={};continue;}
    const at=line.indexOf('=');insist(at>0,'Malformed macro result line.');const key=line.slice(0,at),value=line.slice(at+1);
    const target=NUMBERS.includes(key)||key==='fullName'||key.startsWith('feature.')?current:meta;
    insist(!Object.hasOwn(target,key),'Duplicate result key: '+key);target[key]=value;
  }
  insist(meta.nonce===nonce,'Macro result belongs to another job.');
  if(meta.status!=='ok')throw Object.assign(new Error(meta.errorMessage||'Macro did not complete.'),{code:'ERR_MACRO_EXECUTION',details:meta});
  const observed={};
  for(const phase of ['before-save','reopened']){
    const record=sections[phase];insist(record,'Missing macro readback phase: '+phase);
    for(const key of NUMBERS){insist(typeof record[key]==='string'&&/^-?\d+(?:\.\d+)?$/.test(record[key]),'Invalid getter value: '+key);record[key]=Number(record[key]);insist(Number.isFinite(record[key]),'Nonfinite getter value.');}
    insist(typeof record.fullName==='string','Missing document identity.');
    observed[phase]={settings:Object.fromEntries(STYLE_FIELDS.map(k=>[k,record[k]])),spacingUnit:record.spacingUnit,marginUnit:record.marginUnit,orientation:record.orientation,priority:record.priority,fullName:record.fullName};
    if(meta.featuresVersion!==undefined){
      insist(meta.featuresVersion==='1','Unsupported features result version.');const features={};
      for(const [group,def] of Object.entries(FEATURE_GROUPS)){
        features[group]={};
        for(const [field,info] of Object.entries(def.fields)){
          const key=`feature.${group}.${field}`,value=record[key];insist(typeof value==='string','Missing feature readback: '+key);
          if(info.nullable&&value==='')features[group][field]=null;
          else if(info.type==='string'||(info.type==='font'&&value!=='10'))features[group][field]=value;
          else{insist(/^-?\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value)),'Invalid feature readback: '+key);features[group][field]=Number(value);}
        }
      }
      observed[phase].features=features;
    }
  }
  return {meta,observed};
}

// The per-sheet PDFs a PDF export reported (sheet<i>.kind/.caption/.characters/.saved
// or .errorStep/.error in its result), with the bytes checked and hashed. characters
// is the count of text characters on the sheet (GetString(1) after SelectAll(1);
// figures and images are not counted), null when it was not read (charactersError).
// A sheet without a PDF has path null, a reason and a message:
//   EMPTY_SHEET_NOT_SAVED  the save failed and the sheet has no text characters
//   SAVE_FAILED            the save failed on a sheet with text, or whose text was not read
//   SHEET_FAILED           an error before the save (switching to the sheet, its item, clearing the selection)
//   PDF_NOT_WRITTEN        the save returned but no valid PDF is there
//   NOT_REACHED            the macro stopped at this sheet (an error outside the sheet's own try)
// Empty when the document has fewer than two sheets.
export const sheetPdfPath=(prefix,sheet)=>`${prefix}${sheet}.pdf`;
export async function sheetPdfRecords(meta,prefix){
  const count=/^\d+$/.test(meta.sheets??'')?Number(meta.sheets):0,records=[];
  for(let sheet=1;sheet<=count&&count>=2;sheet++){
    const key=name=>meta[`sheet${sheet}.${name}`],error=key('error');
    if(key('kind')===undefined&&error===undefined)break;
    const record={sheet,kind:/^\d+$/.test(key('kind')??'')?Number(key('kind')):null,caption:key('caption')??null,path:null,characters:/^\d+$/.test(key('characters')??'')?Number(key('characters')):null,
      ...(key('charactersError')!==undefined?{charactersError:key('charactersError')}:{})};
    let bytes=null;if(key('saved')==='1'){try{bytes=await readFileRetry(sheetPdfPath(prefix,sheet));}catch(error){if(error.code!=='ENOENT')throw error;}}
    if(bytes?.length&&bytes.subarray(0,5).toString('latin1')==='%PDF-')Object.assign(record,{path:sheetPdfPath(prefix,sheet),bytes:bytes.length,sha256:hash(bytes),...pdfPageCount(bytes)});
    else if(key('saved')==='1')Object.assign(record,{reason:'PDF_NOT_WRITTEN',message:'SaveDocument returned, but no PDF was written.'});
    else if(error!==undefined)Object.assign(record,{reason:key('errorStep')!=='save'?'SHEET_FAILED':record.characters===0?'EMPTY_SHEET_NOT_SAVED':'SAVE_FAILED',message:key('errorStep')!=='save'?`${key('errorStep')??'unknown step'}: ${error}`:error});
    else Object.assign(record,{reason:'NOT_REACHED',message:meta.errorMessage??'The macro stopped at this sheet.'});
    records.push(record);
  }
  return records;
}
// The sheets whose missing PDF makes the document SHEET_PDF_FAILED: every sheet
// without a PDF except an empty one (EMPTY_SHEET_NOT_SAVED).
export const failedSheetPdfs=records=>records.filter(record=>record.path===null&&record.reason!=='EMPTY_SHEET_NOT_SAVED');

/** Serial, bounded /M/ execution. Timeout never retries or kills the user's app. */
export class MacroAdapter {
  // The outcome of a dispatched macro is unknown in two cases only: no completion
  // marker within the time limit, or an Ichitaro process still running after the
  // marker (exitLimitMs). Then the adapter keeps its lock, writes the reason into
  // it and refuses further work until a person (or an executor's checks at
  // start, src/lock-recovery.mjs) has looked. Sharing violations (EBUSY, EPERM,
  // EACCES) while Ichitaro holds a file are waited out, never an unknown outcome.
  // lockContext (default: JSON in ICHITARO_LOCK_CONTEXT, set by an external
  // executor) is written into the lock, for example the catalog id.
  // readFile (tests) replaces fs.readFile for the files Ichitaro writes or holds.
  // exe and allowRunning default to the environment (resolveIchitaroExe,
  // allowRunningIchitaro); a running Ichitaro is never started into unless allowed.
  constructor({exe,allowRunning,timeoutMs=120000,launch,lockPath,exitLimitMs=60000,processRunning,lockContext,readFile,now=Date.now}={}){
    insist(Number.isFinite(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=300000,'timeoutMs must be 1000..300000.');
    this.exe=resolveIchitaroExe(exe);this.allowRunning=allowRunningIchitaro(allowRunning)===true;this.timeoutMs=timeoutMs;this.now=now;this.suspendedMs=0;
    this.lockPath=lockPath??path.join(os.tmpdir(),'ichitaro-agent-'+hash(this.exe.toLowerCase()).slice(0,16)+'.lock');
    this.launch=launch??((exe,macro)=>new Promise((resolve,reject)=>{
      const child=spawn(exe,['/M/'+macro],{windowsHide:true,stdio:'ignore',detached:true});
      child.once('error',reject);child.once('spawn',()=>{child.unref();resolve({pid:child.pid});});
    }));this.busy=false;this.uncertain=false;
    this.exitLimitMs=exitLimitMs;this.readFile=readFile??fs.readFile;
    this.processRunning=processRunning??(()=>{const name=path.basename(this.exe).toLowerCase();const list=spawnSync('tasklist',['/FI',`IMAGENAME eq ${name}`,'/NH','/FO','CSV'],{encoding:'utf8',windowsHide:true});return list.status===0&&list.stdout.toLowerCase().includes(`"${name}"`);});
    if(lockContext===undefined){try{lockContext=JSON.parse(process.env.ICHITARO_LOCK_CONTEXT??'{}');}catch{lockContext={};}}
    this.lockContext=lockContext&&typeof lockContext==='object'?lockContext:{};
  }
  // The lock names the job, so that a stale lock can be checked mechanically.
  async writeLock(job){
    const handle=await fs.open(this.lockPath,'wx');
    this.lockInfo={pid:process.pid,createdAt:new Date().toISOString(),...job,context:{...this.lockContext,...(job.context??{})}};
    try{await handle.writeFile(JSON.stringify(this.lockInfo));}finally{await handle.close();}
  }
  // An unknown outcome keeps the lock; its reason is added for the people and the
  // heartbeat that read it. A failure to rewrite it leaves the original lock.
  async markLockUncertain(error){
    try{await fs.writeFile(this.lockPath,JSON.stringify({...this.lockInfo,uncertain:true,reason:error.message,code:error.code??null,markedAt:new Date().toISOString()}));}catch{}
  }
  // Waits for the completion marker. A missing file, a sharing violation or a
  // partly written marker (the macro still writing it) is "not yet"; the time
  // limit is the unknown outcome.
  async waitForMarker(donePath,nonce,started,waitMs,message){
    const timer=awakeTimer(started,{now:this.now});
    try{
      for(;;){
        let done;try{done=await this.readFile(donePath,'ascii');}catch(error){if(error.code!=='ENOENT'&&!isSharingViolation(error))throw error;}
        if(done===nonce)return;
        insist(done===undefined||nonce.startsWith(done),'Unexpected completion marker.');
        if(timer.elapsed()>waitMs)throw Object.assign(new Error(message),{code:'ERR_MACRO_TIMEOUT'});
        await pause(100);
      }
    }finally{this.suspendedMs+=timer.suspendedMs;}
  }
  // After the marker Ichitaro quits; one still running at exitLimitMs is the
  // second unknown outcome.
  // A read of a file Ichitaro wrote, with sharing violations retried (src/file-retry.mjs).
  read(file,encoding){return readFileRetry(file,encoding,{read:this.readFile});}
  async requireExit(){
    const exitWaitMs=await this.waitForExit({limitMs:this.exitLimitMs});
    if(exitWaitMs===null){this.uncertain=true;throw Object.assign(new Error(`Ichitaro was still running ${this.exitLimitMs}ms after the macro finished; inspect the application before recovery.`),{code:'ERR_ICHITARO_STILL_RUNNING'});}
    return exitWaitMs;
  }
  async connect(){
    let file=false;try{file=(await fs.stat(this.exe)).isFile();}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!file)throw Object.assign(new Error(`Ichitaro executable is missing: ${this.exe} (pass --exe <taro36.exe> or set ICHITARO_EXE).`),{code:'ERR_ICHITARO_EXE_MISSING',exe:this.exe});
    return {exe:this.exe,adapter:'macro',protocol:'sprint-file-v1'};
  }
  // Every macro starts here. An Ichitaro already running (someone's work) is
  // refused before anything is dispatched, so the outcome is known and the lock
  // is released. Observed once on the author's machine (2026-11-01): /M/ then
  // starts a second taro36.exe, which runs the macro to its end and quits, and
  // the open one and its document stay; but requireExit waits for every
  // taro36.exe, so the run ends as ERR_ICHITARO_STILL_RUNNING with the lock
  // kept. --allow-running-ichitaro / ICHITARO_ALLOW_RUNNING=1 dispatches in
  // spite of that. processRunning asks tasklist; where that is unavailable it
  // reports no process.
  async dispatch(macroPath){
    if(!this.allowRunning&&await this.processRunning())throw Object.assign(new Error(`Ichitaro (${path.basename(this.exe)}) is already running; close it first, or pass --allow-running-ichitaro (ICHITARO_ALLOW_RUNNING=1) to run the macro in spite of it.`),{code:'ERR_ICHITARO_ALREADY_RUNNING',exe:this.exe});
    return this.launch(this.exe,macroPath);
  }
  // Save an existing JTD as PDF (SaveDocument format 23) in a separate run, then
  // close without saving. The JTD bytes must be unchanged afterwards.
  // existing: a JTD this application did not make (CR-006). Built-in warnings are
  // turned off (WarningMode(0)) before opening, and the sheet and document macro
  // counts are read after the PDF is saved; the SaveDocument call is the same.
  // sheetPdfPrefix (with existing, 0.17.0): a document with two or more sheets also
  // gets one PDF per sheet, <prefix><i>.pdf for sheet i counted from the left, by
  // ChangeCurrentSheet(i) and the same SaveDocument call after the default PDF
  // (which holds the sheet current at the last save) is written. Since 0.17.2 every
  // sheet is tried: a failing sheet is reported in sheetPdfs (path null, reason) and
  // the macro still ends with status ok, so the caller decides the outcome.
  // Errors carry a code: ERR_MACRO_TIMEOUT (unknown outcome), ERR_MACRO_EXECUTION
  // (details.errorPhase open/pdf/inspect/sheet <i>/close), ERR_PDF_NOT_WRITTEN and ERR_PDF_JTD_CHANGED.
  async exportPdf({jtd,pdf,workDir,existing=false,sheetPdfPrefix=null,context={}}){
    insist(!this.busy&&!this.uncertain,'Macro runner is busy or a previous execution has an unknown outcome.');
    jtd=path.resolve(jtd);pdf=path.resolve(pdf);workDir=path.resolve(workDir);
    insist(sheetPdfPrefix===null||existing,'Sheet PDFs are made for an existing JTD only.');if(sheetPdfPrefix!==null)sheetPdfPrefix=path.resolve(sheetPdfPrefix);
    try{await fs.access(pdf);throw new Error('Refusing to overwrite a PDF.');}catch(error){if(error.code!=='ENOENT')throw error;}
    this.busy=true;let lock,dispatched=false,completed=false;
    try{
      const nonce=randomUUID(),resultPath=path.join(workDir,'result.txt'),donePath=path.join(workDir,'done.txt'),macroPath=path.join(workDir,'runner.txt');
      await this.writeLock({kind:'pdf',jtd,pdf,workDir,donePath,resultPath,nonce,...(sheetPdfPrefix!==null?{sheetPdfPrefix}:{}),context});lock=true;
      await fs.mkdir(workDir);
      const before=hash(await this.read(jtd));
      // The counts are read after the PDF is written, so a failing getter cannot cost the PDF.
      const inspect=existing?['%phase="inspect"','%sheetCount=GetSheetCount()','%result.LinePrint("sheets=" & %sheetCount)','%result.LinePrint("documentMacros=" & CountMacros(2))']:[];
      // GetCurrentSheetItem returns an array (no set). Each sheet is saved after its kind and caption are written.
      // Each sheet has its own try (nested try statements: T36SPR t26s4jzu), so a failing sheet
      // is written as sheet<i>.errorStep/.error and the loop goes on with the next sheet.
      // The text characters of the sheet (SelectAll(1), GetString(1), Len) are counted in a try of their own
      // before the save, so a failing count costs neither the save nor the other sheets.
      const sheets=sheetPdfPrefix===null?[]:['if %sheetCount >= 2 then','for %i = 1 to %sheetCount','%phase="sheet " & %i','%step="change"','try','ChangeCurrentSheet(%i)','%step="item"','%item=GetCurrentSheetItem()',
        `%result.LinePrint("sheet" & %i & ".kind=" & %item(${macroString('シート種類')}))`,`%result.LinePrint("sheet" & %i & ".caption=" & %item(${macroString('タブ文字列')}))`,
        '%step="characters"','try','SelectAll(1)','%sheetText=GetString(1)','%characters=0','foreach %sheetLine in %sheetText','%characters=%characters+Len(%sheetLine)','next',
        '%result.LinePrint("sheet" & %i & ".characters=" & %characters)','exception','case else','set %err=MacroEngine.LastError','%result.LinePrint("sheet" & %i & ".charactersError=" & %err.Message)','end try',
        '%step="deselect"','CancelMode()','CancelAllRange()','%step="save"',
        `SaveDocument(${literalPath(sheetPdfPrefix)} & %i & ".pdf","","",23)`,'%result.LinePrint("sheet" & %i & ".saved=1")',
        'exception','case else','set %err=MacroEngine.LastError','%result.LinePrint("sheet" & %i & ".errorStep=" & %step)','%result.LinePrint("sheet" & %i & ".error=" & %err.Message)','end try','next','end if'];
      const source=[`set %result=OpenFile(${literalPath(resultPath)},&H0106,1,5)`,`%result.LinePrint("nonce=${nonce}")`,'%success=0','%phase="open"','try',
        ...(existing?['WarningMode(0)']:[]),`OpenDocumentFile(${literalPath(jtd)})`,'%phase="pdf"',`SaveDocument(${literalPath(pdf)},"","",23)`,...inspect,...sheets,'%phase="close"','set %doc=Application.ActiveDocument','%doc.Close(3)',
        '%result.LinePrint("status=ok")','%success=1','exception','case else','set %err=MacroEngine.LastError','%result.LinePrint("status=error")',
        '%result.LinePrint("errorPhase=" & %phase)','%result.LinePrint("errorMessage=" & %err.Message)','end try','%result.Close()',
        `set %done=OpenFile(${literalPath(donePath)},&H0106,1,1)`,`%done.Write("${nonce}")`,'%done.Close()','Application.Quit(3)','end'].join('\r\n')+'\r\n';
      await fs.writeFile(macroPath,source,{encoding:'ascii',flag:'wx'});
      this.suspendedMs=0;const started=this.now();await this.dispatch(macroPath);dispatched=true;
      await this.waitForMarker(donePath,nonce,started,this.timeoutMs,'PDF export timed out; inspect the application before recovery.');completed=true;
      const durationMs=Date.now()-started,exitWaitMs=await this.requireExit();
      const meta=Object.fromEntries(decodeMacroText(await this.read(resultPath)).split(/\r?\n/).filter(Boolean).map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]));
      insist(meta.nonce===nonce,'PDF export result belongs to another job.');
      const macro={source:macroPath,result:resultPath};
      const after=hash(await this.read(jtd));
      if(meta.status!=='ok')throw Object.assign(new Error(meta.errorMessage||'PDF export failed.'),{code:'ERR_MACRO_EXECUTION',details:meta,macro,jtdSha256:before,jtdSha256AfterClose:after,durationMs});
      let bytes=null;try{bytes=await this.read(pdf);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(!bytes||!bytes.length||bytes.subarray(0,5).toString('latin1')!=='%PDF-')throw Object.assign(new Error('The application did not write a PDF.'),{code:'ERR_PDF_NOT_WRITTEN',macro,jtdSha256:before,jtdSha256AfterClose:after,durationMs});
      const count=key=>/^\d+$/.test(meta[key]??'')?Number(meta[key]):null;
      const record={path:pdf,bytes:bytes.length,sha256:hash(bytes),...pdfPageCount(bytes),method:'SaveDocument format 23 (PDF) from the saved JTD in a separate macro run; closed without saving',
        jtdSha256:before,jtdSha256AfterClose:after,jtdUnchanged:after===before,durationMs,exitWaitMs,...(this.suspendedMs?{suspendedMs:this.suspendedMs}:{}),macro,...(existing?{warningMode:0,sheets:count('sheets'),documentMacros:count('documentMacros')}:{}),
        ...(sheetPdfPrefix!==null?{sheetPdfs:await sheetPdfRecords(meta,sheetPdfPrefix)}:{})};
      if(after!==before)throw Object.assign(new Error('The JTD changed during PDF export.'),{code:'ERR_PDF_JTD_CHANGED',pdf:record,macro,jtdSha256:before,jtdSha256AfterClose:after,durationMs});
      return record;
    }catch(error){if(dispatched&&!completed)this.uncertain=true;if(lock&&this.uncertain)await this.markLockUncertain(error);throw error;}
    finally{this.busy=false;if(lock&&!this.uncertain)await fs.unlink(this.lockPath);}
  }
  // Wait (bounded, never killing) until no Ichitaro process is left after Quit,
  // so that the next /M/ run starts a fresh instance. Returns the wait in ms, or
  // null when a process was still running at the limit.
  async waitForExit({limitMs=30000}={}){
    const timer=awakeTimer(this.now(),{now:this.now});
    try{
      for(;;){
        if(!await this.processRunning())return timer.elapsed();
        if(timer.elapsed()>=limitMs)return null;
        await pause(250);
      }
    }finally{this.suspendedMs+=timer.suspendedMs;}
  }
  async createSample({sample,styleSource=null,bodyParagraphs=false,input=null,text,settings,layoutPriority='preserve',features={},captureFeatures=false,targets,operations=[],keisenCanvas,keisenOperations=[],paragraphTargets,paragraphOperations=[],footnote,namedStyle,headerSteps,headerPosition,headerPages,documentColumns,frames,headerLayout,namedStyles,columnRange,timeoutMs}){
    if(targets){targets=validateTargets(targets,text);operations=validateOperations(operations,targets);}
    if(keisenCanvas){keisenCanvas=validateKeisenCanvas(keisenCanvas,text);keisenOperations=validateKeisenOperations(keisenOperations,keisenCanvas);}
    features=validateFeatures(features);captureFeatures=captureFeatures||Object.keys(features).length>0;
    insist(!this.busy&&!this.uncertain,'Macro runner is busy or a previous execution has an unknown outcome.');validateSettings(settings);
    // CR-001: the new document's style is kept, so nothing that compiles to a
    // document style setter (or SetDocumentStyle) may reach the macro.
    insist(styleSource===null||(styleSource==='new-document'&&!Object.keys(settings).length&&!Object.keys(features).length&&layoutPriority==='preserve'&&!keisenCanvas&&!paragraphTargets&&footnote===undefined&&namedStyle===undefined&&headerSteps===undefined&&documentColumns===undefined&&frames===undefined&&headerLayout===undefined&&namedStyles===undefined&&columnRange===undefined),'styleSource new-document allows text and range operations only, without settings or features.');
    this.busy=true;
    let lock,dispatched=false,completed=false;
    try {
    const dir=path.resolve(sample.dir),output=path.resolve(sample.documentPath);
    const nonce=randomUUID(),job=path.join(dir,'macro'),resultPath=path.join(job,'result.txt'),bodyPath=path.join(job,'body.txt'),donePath=path.join(job,'done.txt'),macroPath=path.join(job,'runner.txt');
    await this.writeLock({kind:'sample',sampleDir:dir,output,donePath,resultPath,nonce});lock=true;
    insist(path.dirname(output)===dir&&path.basename(output)==='document.jtd','Output must be the managed sample document.jtd.');
    try{await fs.access(output);throw new Error('Refusing to overwrite a JTD.');}catch(error){if(error.code!=='ENOENT')throw error;}
    const inputHash=input?hash(await this.read(input)):null;
    await fs.mkdir(job);
    const source=compileSample({nonce,bodyParagraphs,input,output,text,settings,layoutPriority,features,captureFeatures,targets,operations,keisenCanvas,keisenOperations,paragraphTargets,paragraphOperations,footnote,namedStyle,headerSteps,headerPosition,headerPages,documentColumns,frames,headerLayout,namedStyles,columnRange,resultPath,bodyPath,donePath});
    await fs.writeFile(macroPath,source,{encoding:'ascii',flag:'wx'});
    await fs.writeFile(path.join(job,'command.json'),JSON.stringify({schemaVersion:1,command:'create-sample',nonce,styleSource,bodyParagraphs,input,output,text,settings,layoutPriority,features,captureFeatures,targets,operations,keisenCanvas,keisenOperations,paragraphTargets,paragraphOperations,footnote,namedStyle,headerSteps,headerPosition,headerPages,documentColumns,frames,headerLayout,namedStyles,columnRange},null,2),{flag:'wx'});
    // A caller may extend the wait for long readbacks (still capped at 300s).
    const waitMs=timeoutMs===undefined?this.timeoutMs:(insist(Number.isFinite(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=300000,'timeoutMs must be 1000..300000.'),timeoutMs);
    this.suspendedMs=0;const started=this.now();
      const launch=await this.dispatch(macroPath);dispatched=true;
      await this.waitForMarker(donePath,nonce,started,waitMs,'Macro timed out; inspect the application before recovery. Do not retry this job.');completed=true;
      await this.requireExit();
      const resultBytes=await this.read(resultPath);const parsed=parseMacroResult(resultBytes,nonce);
      if(captureFeatures)insist(parsed.meta.featuresVersion==='1','Extended feature readback was not returned.');
      insist(path.resolve(parsed.meta.savedPath).toLowerCase()===output.toLowerCase()&&path.resolve(parsed.observed.reopened.fullName).toLowerCase()===output.toLowerCase(),'Macro opened or saved a different document.');
      if(input)insist(path.resolve(parsed.observed['before-save'].fullName).toLowerCase()===path.resolve(input).toLowerCase(),'Macro did not edit the requested baseline.');
      insist((await fs.stat(output)).size>0,'The application did not save a JTD.');
      if(input)insist(hash(await this.read(input))===inputHash,'Baseline bytes changed.');
      const body=decodeMacroText(await this.read(bodyPath)).replace(/\r\n|\r/g,'\n').replace(/\n$/,'');
      const expectedText=footnote?footnoteBody(text,footnote):text.replace(/\r\n|\r/g,'\n');
      const differences=[];
      let footnoteProof,rangeProof,keisenProof,paragraphProof,columnProof,headerProof,namedStyleProof,frameProof,headerLayoutProof,styleProof;
      if(namedStyles!==undefined){const v=verifyStyleDefinitions(parsed.meta,{text,trial:namedStyles,baseSize:features.font?.size??10.5});differences.push(...v.differences);styleProof=v.proof;for(const phase of ['before-save','reopened'])parsed.observed[phase].namedStyles=v.snapshots[phase];for(const k of Object.keys(parsed.meta))if(k.startsWith('styles.'))delete parsed.meta[k];}
      if(headerLayout!==undefined){const v=verifyHeaderLayout(parsed.meta,{text,layout:headerLayout});differences.push(...v.differences);headerLayoutProof=v.proof;for(const phase of ['before-save','reopened'])parsed.observed[phase].headerLayout=v.snapshots[phase];for(const k of Object.keys(parsed.meta))if(k.startsWith('headerLayout.'))delete parsed.meta[k];}
      if(frames!==undefined){const v=verifyFrames(parsed.meta,{text,frames});differences.push(...v.differences);frameProof=v.proof;for(const phase of ['before-save','reopened'])parsed.observed[phase].frames=v.snapshots[phase];for(const k of Object.keys(parsed.meta))if(k.startsWith('frame.'))delete parsed.meta[k];}
      if(footnote){const v=verifyFootnote(parsed.meta,{text,trial:footnote});differences.push(...v.differences);footnoteProof=v.proof;for(const phase of ['before-save','reopened'])parsed.observed[phase].footnote=v.snapshots[phase];for(const k of Object.keys(parsed.meta))if(k.startsWith('footnote.'))delete parsed.meta[k];}
      if(namedStyle){const v=verifyNamedStyle(parsed.meta,{text,trial:namedStyle});differences.push(...v.differences);namedStyleProof=v.proof;for(const phase of ['before-save','reopened'])parsed.observed[phase].namedStyle=v.snapshots[phase];for(const k of Object.keys(parsed.meta))if(k.startsWith('namedStyle.'))delete parsed.meta[k];}
      if(headerSteps!==undefined){const h=verifyHeader(parsed.meta,{text,pages:headerPages,position:headerPosition,steps:headerSteps,body:expectedText,ignoreEmptyLines:documentColumns!==undefined,ignoreSpaces:frames!==undefined});differences.push(...h.differences);headerProof=h.proof;for(const phase of ['before-save','reopened'])parsed.observed[phase].header=h.snapshots[phase];for(const k of Object.keys(parsed.meta))if(k.startsWith('header.'))delete parsed.meta[k];}
      if(documentColumns!==undefined){const c=verifyColumns(parsed.meta,{text,steps:documentColumns,ignoreSpaces:frames!==undefined,range:columnRange});differences.push(...c.differences);columnProof=c.proof;for(const phase of ['before-save','reopened'])parsed.observed[phase].documentColumns=c.snapshots[phase];for(const k of Object.keys(parsed.meta))if(k.startsWith('columns.'))delete parsed.meta[k];}
      if(paragraphTargets){const p=verifyParagraphReadback(parsed.meta,{text,targets:paragraphTargets,operations:paragraphOperations,ignoreSpaces:frames!==undefined});differences.push(...p.differences);paragraphProof=p.proof;for(const stage of ['before-save','reopened'])parsed.observed[stage].paragraphs=p.snapshots[stage];for(const k of Object.keys(parsed.meta))if(k.startsWith('paragraph.'))delete parsed.meta[k];}
      if(keisenCanvas){const r=verifyKeisenReadback(parsed.meta,{canvas:keisenCanvas,operations:keisenOperations});differences.push(...r.differences);keisenProof=r.proof;for(const stage of ['before-save','reopened'])parsed.observed[stage].keisen=r.snapshots[stage];for(const k of Object.keys(parsed.meta))if(k.startsWith('keisen.'))delete parsed.meta[k];}
      if(targets){
        const rangeResult=verifyRangeReadback(parsed.meta,{text,targets,operations});
        differences.push(...rangeResult.differences);rangeProof=rangeResult.proof;
        parsed.observed['before-save'].characters=rangeResult.snapshots['before-save'];
        parsed.observed.reopened.characters=rangeResult.snapshots.reopened;
        for(const key of Object.keys(parsed.meta))if(key.startsWith('range.'))delete parsed.meta[key];
      }
      let bodyParagraphProof=null;
      if(bodyParagraphs){const b=verifyBodyParagraphs(parsed.meta,{text:expectedText,body});differences.push(...b.differences);bodyParagraphProof=b.proof;parsed.observed.reopened.bodyParagraphs=b.snapshots.reopened;}
      if(captureFeatures){
        for(const [group,values] of Object.entries(features))for(const [field,expected] of Object.entries(values)){
          const actual=parsed.observed['before-save'].features[group][field];
          if(actual!==expected)differences.push({phase:'requested',field:`features.${group}.${field}`,expected,actual});
        }
        for(const [group,values] of Object.entries(parsed.observed['before-save'].features))for(const [field,expected] of Object.entries(values)){
          const actual=parsed.observed.reopened.features[group][field];
          if(actual!==expected)differences.push({phase:'reopened',field:`features.${group}.${field}`,expected,actual});
        }
      }
      // A kept new-document style may use other units; they are recorded, and
      // only compared between before-save and reopened below.
      if(styleSource===null&&(parsed.observed['before-save'].spacingUnit!==100||parsed.observed['before-save'].marginUnit!==1))differences.push({phase:'requested',field:'units',expected:'spacing percent (100), margins mm (1)'});
      for(const [field,expected] of Object.entries(settings))if(parsed.observed['before-save'].settings[field]!==expected)differences.push({phase:'requested',field,expected,actual:parsed.observed['before-save'].settings[field]});
      if(layoutPriority!=='preserve'&&parsed.observed['before-save'].priority!==(layoutPriority==='counts'?1:0))differences.push({phase:'requested',field:'priority',expected:layoutPriority});
      for(const field of STYLE_FIELDS)if(parsed.observed['before-save'].settings[field]!==parsed.observed.reopened.settings[field])differences.push({phase:'reopened',field,expected:parsed.observed['before-save'].settings[field],actual:parsed.observed.reopened.settings[field]});
      for(const field of ['spacingUnit','marginUnit','orientation','priority'])if(parsed.observed['before-save'][field]!==parsed.observed.reopened[field])differences.push({phase:'reopened',field});
      // GetString(1) returns physical lines, not logical paragraphs. Only a
      // newline-free request permits ignoring readback line separators. Keep
      // body untouched as evidence; this does not prove paragraph structure.
      const ignoreReadbackLineBreaks=!bodyParagraphs&&!keisenCanvas&&!expectedText.includes('\n')&&body.includes('\n');
      const cellTextExpected=parsed.observed.reopened.keisen?.texts;
      const structuredBody=parsed.observed.reopened.keisen?.bodyNonWhitespace;
      // CR-009: leading paragraphs come before the table; the body without whitespace starts with their text.
      const leadingText=keisenCanvas?.leading?.map(p=>p.text).join('')??'',tableText=structuredBody??(cellTextExpected?Object.values(cellTextExpected).join(''):'');
      // Multi-paragraph range bodies wrap physically; characters are proven one by one by the range proof.
      const rangeParagraphs=!!targets&&expectedText.includes('\n');
      const bodyComparison=bodyParagraphs?'long-text-joined-lines-and-paragraph-walk':rangeParagraphs?'range-characters-and-joined-string':frames!==undefined?'frame-body-characters-and-space-free-string':documentColumns!==undefined?'logical-paragraph-characters-and-column-getters':paragraphTargets&&expectedText.includes('\t')?'paragraph-text-with-independent-tab-type-check':keisenCanvas?(structuredBody!==undefined?'physical-cell-lines-and-body-nonwhitespace':cellTextExpected?'cell-text-exact-and-body-nonwhitespace':'blank-canvas-whitespace-only'):ignoreReadbackLineBreaks?'single-paragraph-ignore-readback-line-breaks':'exact-text';
      const bodyComparisonDetails=ignoreReadbackLineBreaks?{
        ignoredReadbackLineBreaks:body.split('\n').length-1,
        limitation:'Readback line breaks treated as visual wrapping; explicit paragraph breaks cannot be distinguished by GetString(1).',
      }:undefined;
      const bodyMatches=bodyParagraphs?bodyParagraphProof?.passed===true&&body.replaceAll('\n','')===expectedText.replaceAll('\n',''):rangeParagraphs?body.replaceAll('\n','')===expectedText.replaceAll('\n',''):frames!==undefined?frameProof?.bodyCharactersVerified===true&&!differences.some(d=>typeof d.field==='string'&&d.field.startsWith('body.'))&&(documentColumns!==undefined?columnProof?.passed===true&&body.replaceAll(' ','').replaceAll('\n','')===expectedText.replaceAll('\n',''):body.replaceAll(' ','')===expectedText):documentColumns!==undefined?columnProof?.passed===true&&body.replaceAll('\n','')===expectedText.replaceAll('\n',''):paragraphTargets?paragraphProof?.characterIdentityVerified===true&&body===expectedText.replaceAll('\t',' '):keisenCanvas?body.replace(/\s/gu,'')===leadingText+tableText:(ignoreReadbackLineBreaks?body.replaceAll('\n',''):body)===expectedText;
      if(keisenCanvas)parsed.observed.reopened.bodyText=body;
      if(!bodyMatches)differences.push({phase:'body',field:'text',expected:keisenCanvas?(leadingText+tableText||'blank canvas (whitespace only)'):expectedText,actual:body});
      return {source,resultBytes,...parsed,body,launch,durationMs:Date.now()-started,...(this.suspendedMs?{suspendedMs:this.suspendedMs}:{}),verification:{method:'macro-getter',passed:differences.length===0&&!paragraphProof?.reviewRequired,reopened:true,bodyMatches,bodyComparison,...(bodyComparisonDetails?{bodyComparisonDetails}:{}),differences,...(footnoteProof?{footnoteProof}:{}),...(rangeProof?{rangeProof}:{}),...(keisenProof?{keisenProof}:{}),...(paragraphProof?{paragraphProof}:{}),...(columnProof?{columnProof}:{}),...(headerProof?{headerProof}:{}),...(namedStyleProof?{namedStyleProof}:{}),...(frameProof?{frameProof}:{}),...(headerLayoutProof?{headerLayoutProof}:{}),...(styleProof?{styleProof}:{}),...(bodyParagraphProof?{bodyParagraphProof}:{}),scope:'8 numeric fields, units, orientation, priority, document paths and selected plain text'+(captureFeatures?'; font, paper and document-style columns':'')+(targets?'; per-character range attributes, identity and outside checks':'')+(paragraphTargets?'; paragraph text identity and all attribute slots in every paragraph':'')+(keisenCanvas?'; bounded ruled-line grid and cell probes; '+bodyComparison:'')+(ignoreReadbackLineBreaks?'; readback line breaks ignored for newline-free request':'')+(bodyParagraphs?'; long body: joined lines, line partition and paragraph walk':'')}};
    }catch(error){if(dispatched&&!completed)this.uncertain=true;if(lock&&this.uncertain)await this.markLockUncertain(error);throw error;}
    finally{this.busy=false;if(lock&&!this.uncertain)await fs.unlink(this.lockPath);}
  }
}


