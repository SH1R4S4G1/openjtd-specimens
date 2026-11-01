import {planFootnotes,footnoteSequenceMacro,verifyFootnoteSequence} from './footnote-sequence.mjs';
// Public Sprint Footnote/JumpFootnote API; one numbered note at paragraph 2 start.
export const FOOTNOTE_FIELDS=['text','steps'];
const paragraphs=text=>text.replace(/\r\n|\r/g,'\n').split('\n');
export function validateFootnote(value,text){
 if(value&&Object.hasOwn(value,'steps'))return planFootnotes(value,text).trial;
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).some(k=>!FOOTNOTE_FIELDS.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value')))throw Error('Footnote requires a plain text record');
 if(value.text!==null&&(typeof value.text!=='string'||!value.text.length||value.text.length>24||/[\s\p{C}\p{M}]/u.test(value.text)))throw Error('Footnote text must be null (control) or 1..24 non-whitespace BMP characters');
 const lines=paragraphs(text);if(lines.length!==3||lines.some(s=>!s.length||s.length>24||/[\s\p{C}\p{M}\uD800-\uDFFF]/u.test(s))||value.text&&/[\uD800-\uDFFF]/.test(value.text))throw Error('Footnote trial requires three short BMP paragraphs');
 return {text:value.text};
}
export function footnoteBody(text,trial){if(trial.steps)return planFootnotes(trial,text).states.at(-1).body.join('\n');const lines=paragraphs(text);if(trial.text!==null)lines[1]='1'+lines[1];return lines.join('\n');}
export function footnoteMacro({text,trial,q}){
 if(trial.steps)return footnoteSequenceMacro({text,trial,q});
 trial=validateFootnote(trial,text);const at=p=>['CancelAllRange()','JumpStart()',...(p?['NextParagraph('+p+')']:[])];
 const emit=(key,expression)=>'%result.LinePrint('+q(key+'=')+' & '+expression+')';
 function snapshot(stage,active=trial.text!==null){const b='footnote.'+stage+'.',out=[];
  for(const [p,line] of paragraphs(text).entries()){out.push(...at(p));const expected=(active&&p===1?'1':'')+line;
   for(let k=0;k<expected.length;k++)out.push(emit(b+'body.'+p+'.'+k,'GetCharacter()'),'CursorRight(1)');
  }
  out.push(...at(1),emit(b+'bodyArea','GetCursorArea()'));
  if(active)out.push(emit(b+'number','GetFootnoteNumber()'),'JumpFootnote(1,1)',emit(b+'noteArea','GetCursorArea()'),emit(b+'noteOpen','GetFootnoteArea()'),'SelectAll(1)','%fnLines=GetString(1)','%fnCount=0','foreach %fnLine in %fnLines','%fnCount=%fnCount+1','%result.LinePrint('+q(b+'note.')+' & %fnCount & "=" & %fnLine)','next',emit(b+'noteCount','%fnCount'),'CancelAllRange()','JumpStart()','JumpFootnote(2,1)',emit(b+'returnArea','GetCursorArea()'),emit(b+'returnNumber','GetFootnoteNumber()'),emit(b+'returnChar','GetCharacter()'));
  out.push(...at(0));return out;
 }
 const apply=snapshot('initial',false);
 if(trial.text!==null)apply.push(...at(1),'Footnote('+q('%1')+',1)','if GetCursorArea() = 1 then','CursorLeft(1)','JumpFootnote(1,1)','end if',emit('footnote.insertArea','GetCursorArea()'),'SelectAll(1)','%fnPrefix=GetString(1)','%fnCount=0','foreach %fnLine in %fnPrefix','%fnCount=%fnCount+1','%result.LinePrint('+q('footnote.prefix.')+' & %fnCount & "=" & %fnLine)','next',emit('footnote.prefixCount','%fnCount'),'CancelAllRange()','JumpEnd()',emit('footnote.contentArea','GetCursorArea()'),'Insert('+q(trial.text)+')','CancelAllRange()','JumpStart()','JumpFootnote(2,1)');
 return {apply,snapshot};
}
export function verifyFootnote(meta,{text,trial}){
 if(trial.steps)return verifyFootnoteSequence(meta,{text,trial});
 trial=validateFootnote(trial,text);const snapshots={},differences=[],checks=[];
 const read=k=>{if(typeof meta[k]!=='string')throw Error('Missing footnote getter: '+k);return meta[k];};
 const compare=(stage,key,actual,expected)=>{if(actual!==expected)differences.push({phase:stage,field:key,actual,expected});};
 let prefix=null;
 if(trial.text!==null){compare('insert','cursorArea',read('footnote.insertArea'),'3');compare('insert','contentArea',read('footnote.contentArea'),'3');compare('insert','prefixCount',read('footnote.prefixCount'),'1');prefix=read('footnote.prefix.1');if(!prefix.length||prefix.length>24)throw Error('Invalid footnote prefix');}
 for(const stage of ['initial','before-save','reopened']){
  const active=stage!=='initial'&&trial.text!==null,b='footnote.'+stage+'.',body=paragraphs(footnoteBody(text,{text:active?trial.text:null})).map((line,p)=>{const actual=Array.from(line,(_,k)=>read(b+'body.'+p+'.'+k)).join('');compare(stage,'body.'+p,actual,line);return actual;});
  const actual={body,bodyArea:read(b+'bodyArea')};compare(stage,'bodyArea',actual.bodyArea,'1');
  if(active){for(const [field,want] of Object.entries({number:'1',noteArea:'3',noteOpen:'TRUE',noteCount:'1',returnArea:'1',returnNumber:'1',returnChar:'1'})){actual[field]=read(b+field);compare(stage,field,actual[field],want);}actual.note=read(b+'note.1');
   // The note-area label is display state: either the prefix read at creation
   // ("*1") or the current number ("1"). Membership is proven by the round trip.
   actual.prefixForm=actual.note===prefix+trial.text?'captured':actual.note==='1'+trial.text?'number':null;
   if(!actual.prefixForm)compare(stage,'note',actual.note,prefix+trial.text);}
  snapshots[stage]=actual;checks.push({stage,passed:!differences.some(d=>d.phase===stage),strength:'body characters, numbered anchor, corresponding note content and round-trip area'});
 }
 return {snapshots,differences,proof:{version:1,trial,prefix,passed:!differences.length,reopened:!differences.some(d=>d.phase==='reopened'),checks,scope:'One numbered footnote at start of second paragraph; all body characters and note text, corresponding jumps before save and after reopen',limitations:['Fixed %1 numbering and size mode 1; default footnote styles','Three short horizontal paragraphs, one short note; no replacement, removal, multiple notes or pagination','Generated note prefix is captured before text insertion, not forced; physical placement, style inheritance and other character formatting are not verified','Internal Recipe only']}};
}
