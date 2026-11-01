// Document-local styles only. System registration macros are deliberately absent.
export const NAMED_STYLE_FIELDS=['kind','steps'];
const ORDER=['define','apply','direct','redefine','clear'];
export function validateNamedStyle(value,text){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).some(k=>!NAMED_STYLE_FIELDS.includes(k))||!['character','paragraph'].includes(value.kind))throw Error('Named style requires kind character/paragraph and steps');
 if(!Array.isArray(value.steps)||value.steps.length>ORDER.length||Array.from(value.steps).some((s,i)=>s!==ORDER[i]))throw Error('Named style steps must be a prefix of define,apply,direct,redefine,clear');
 const lines=text.replace(/\r\n|\r/g,'\n').split('\n');if(lines.length!==3||lines.some(s=>!s.length||s.length>24||/[\s\x00-\x1f\x7f\uD800-\uDFFF\p{M}]/u.test(s)))throw Error('Named style trial requires three short BMP paragraphs');
 return {kind:value.kind,steps:[...value.steps]};
}
export function namedStyleMacro({text,trial,q}){
 trial=validateNamedStyle(trial,text);const name='AgentTrial'+trial.kind,lines=text.replace(/\r\n|\r/g,'\n').split('\n');
 const at=n=>['CancelAllRange()','JumpStart()',...(n?['NextParagraph('+n+')']:[])];
 const select=[...at(1),'RangeMode(3)','RangeStart()','RangeEnd(1,1)'];
 function snapshot(stage){const b='namedStyle.'+stage+'.',out=['CancelAllRange()','%nsList=Get'+(trial.kind==='character'?'Character':'Paragraph')+'StyleList(1)','%nsN=0','foreach %nsV in %nsList','%nsN=%nsN+1','%result.LinePrint('+q(b+'registered.')+' & %nsN & "=" & %nsV)','next','%result.LinePrint('+q(b+'registeredCount=')+' & %nsN)'];
  for(const [p,line] of lines.entries()){out.push(...at(p));for(let k=0;k<line.length;k++){const key=b+p+'.'+k;out.push('%nsA=GetCharacterAttribute()','%result.LinePrint('+q(key+'.char=')+' & GetCharacter())','%result.LinePrint('+q(key+'.point=')+' & GetCharacterPoint())','%result.LinePrint('+q(key+'.direct=')+' & %nsA('+q('文字サイズ')+'))','%result.LinePrint('+q(key+'.paragraphStyle=')+' & GetParagraphStyleName())','CursorRight(1)');}}
  out.push(...at(0));return out;
 }
 const apply=snapshot('initial');for(const [i,step] of trial.steps.entries()){
  if(step==='define'||step==='redefine')apply.push('Entry'+(trial.kind==='character'?'Character':'Paragraph')+'Style('+q(name)+',,,,,'+(step==='define'?12:16)+')');
  if(step==='apply')apply.push(...select,trial.kind==='character'?'CharacterStyle('+q(name)+')':'SetParagraphStyle(1,'+q(name)+')');
  if(step==='direct')apply.push(...select,'CharacterAttribute(,,,,14)');
  if(step==='clear')apply.push(...select,'Cancel'+(trial.kind==='character'?'Character':'Paragraph')+'Style()');
  apply.push(...snapshot('step-'+i));
 }return {apply,snapshot};
}
export function verifyNamedStyle(meta,{text,trial}){
 trial=validateNamedStyle(trial,text);const name='AgentTrial'+trial.kind,lines=text.replace(/\r\n|\r/g,'\n').split('\n'),snapshots={},differences=[],checks=[];
 const read=k=>{if(typeof meta[k]!=='string')throw Error('Missing named style readback: '+k);return meta[k];};
 const compare=(stage,key,actual,expected)=>{if(JSON.stringify(actual)!==JSON.stringify(expected))differences.push({phase:stage,field:key,actual,expected});};
 for(const [stage,n] of [['initial',0],...trial.steps.map((_,i)=>['step-'+i,i+1]),['before-save',trial.steps.length],['reopened',trial.steps.length]]){
  const b='namedStyle.'+stage+'.',count=read(b+'registeredCount');if(!/^\d+$/.test(count)||+count>1000)throw Error('Invalid style registry count');
  const registered=Array.from({length:+count},(_,i)=>read(b+'registered.'+(i+1)));
  if(stage==='initial'){if(registered.includes(name))throw Error('Trial style name already registered');}else compare(stage,'registry',[...registered].sort(),[...snapshots.initial.registered,...(n?[name]:[])].sort()); // Ichitaro lists names in its own order; compare as a set (counts included).
  const paragraphs=lines.map((line,p)=>Array.from(line,(char,k)=>{const key=b+p+'.'+k,actual={char:read(key+'.char'),point:read(key+'.point'),direct:read(key+'.direct'),paragraphStyle:read(key+'.paragraphStyle')};const target=p===1,expected={char,point:target&&n>=2?(n>=3?'14':'12'):'10.5',direct:target&&n>=3?'14':'10.5',paragraphStyle:target&&trial.kind==='paragraph'&&n>=2&&n<5?name:''};compare(stage,key,actual,expected);return actual;}));
  snapshots[stage]={registered,paragraphs};checks.push({stage,passed:!differences.some(d=>d.phase===stage),strength:'every-character-effective-point-and-direct-size; document registry; paragraph style name'});
 }
 return {snapshots,differences,proof:{version:1,trial,passed:!differences.length,reopened:!differences.some(d=>d.phase==='reopened'),checks,scope:'Middle paragraph; every character in all three paragraphs; style registry names, effective size and direct size compared separately',limitations:['Fixed 12pt definition, 14pt direct override, 16pt redefinition; prefix sequence only','Registry proves definition name exists, not its complete contents; character style assignment name has no verified getter','Redefinition with a direct override checks that 14pt remains, not that the stored definition is 16pt','Style removal preserves direct 14pt; other style attributes and full inheritance graph are not verified','Document-local definitions only; horizontal short text; no other structural operations']}};
}
