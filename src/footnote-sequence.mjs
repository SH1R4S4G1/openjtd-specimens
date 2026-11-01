// Stable logical offsets refer to the original body, never to inserted note markers.
export const FOOTNOTE_BODY_FIELDS=['text'];
export const FOOTNOTE_SEQUENCE_FIELDS=['steps'];
export const FOOTNOTE_STEP_FIELDS=['action','id','paragraph','offset','text'];
const insist=(ok,msg)=>{if(!ok)throw Error('Footnote sequence: '+msg);};
function record(value,keys){insist(value&&Object.getPrototypeOf(value)===Object.prototype,'plain record required');for(const k of Reflect.ownKeys(value))insist(typeof k==='string'&&keys.includes(k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value'),'unknown or non-data field');}
const safeText=s=>typeof s==='string'&&s.length>0&&s.length<=24&&!/[\s\p{C}\p{M}\uD800-\uDFFF\u{10000}-\u{10FFFF}]/u.test(s);
export function planFootnotes(trial,text){
 record(trial,FOOTNOTE_SEQUENCE_FIELDS);insist(typeof text==='string','body text required');
 const paragraphs=text.replace(/\r\n|\r/g,'\n').split('\n');
 insist(paragraphs.length>=1&&paragraphs.length<=8&&paragraphs.every(s=>safeText(s)),'one to eight nonempty BMP paragraphs, max 24 characters each');
 insist(Array.isArray(trial.steps)&&trial.steps.length<=24,'at most 24 steps required');
 let notes=[];const used=new Set(),steps=[],states=[];
 const snapshot=()=>{const sorted=notes.map(n=>({...n})).sort((a,b)=>a.paragraph-b.paragraph||a.offset-b.offset);const resolved=sorted.map((n,i)=>({...n,number:i+1,cursorOffset:n.offset+sorted.filter(m=>m.paragraph===n.paragraph&&m.offset<n.offset).length}));
  const body=paragraphs.map((line,p)=>{let result='';for(let k=0;k<=line.length;k++){const note=resolved.find(n=>n.paragraph===p&&n.offset===k);if(note)result+=note.number;if(k<line.length)result+=line[k];}return result;});
  return {notes:resolved,body};
 };
 states.push(snapshot());
 for(const input of Array.from(trial.steps)){
  record(input,FOOTNOTE_STEP_FIELDS);const op={...input};insist(['add','modify','remove'].includes(op.action),'unknown action');insist(typeof op.id==='string'&&/^[a-z][a-z0-9-]{0,39}$(?![\s\S])/.test(op.id),'invalid stable note ID');
  const found=notes.find(n=>n.id===op.id);
  if(op.action==='add'){
   insist(!used.has(op.id),'note ID must be unique across the history');insist(used.size<8,'at most eight created notes per history');
   insist(Number.isInteger(op.paragraph)&&op.paragraph>=0&&op.paragraph<paragraphs.length&&Number.isInteger(op.offset)&&op.offset>=0&&op.offset<=paragraphs[op.paragraph].length,'anchor outside original body');
   insist(!notes.some(n=>n.paragraph===op.paragraph&&n.offset===op.offset),'only one active note per logical offset');insist(safeText(op.text),'invalid note text');
   used.add(op.id);notes.push({id:op.id,paragraph:op.paragraph,offset:op.offset,text:op.text});
  }else{
   insist(found,'modify/remove requires an active note');insist(op.paragraph===undefined&&op.offset===undefined,'modify/remove uses stable ID, not a new anchor');
   if(op.action==='modify'){insist(safeText(op.text),'invalid note text');found.text=op.text;}
   else{insist(op.text===undefined,'remove takes no text');notes=notes.filter(n=>n.id!==op.id);}
  }
  steps.push(op);states.push(snapshot());
 }
 return {trial:{steps},paragraphs,states};
}

export function footnoteSequenceMacro({text,trial,q}){
 const plan=planFootnotes(trial,text);
 const at=(p,k=0)=>['CancelAllRange()','JumpStart()',...(p?['NextParagraph('+p+')']:[]),...(k?['CursorRight('+k+')']:[])];
 const emit=(k,e)=>'%result.LinePrint('+q('footnotes.'+k+'=')+' & '+e+')';
 const readParagraph=k=>['CancelAllRange()','RangeMode(3)','RangeStart()','RangeEnd(1,1)','%fnLines=GetString(1)','%fnCount=0','foreach %fnLine in %fnLines','%fnCount=%fnCount+1','%result.LinePrint('+q('footnotes.'+k+'.line.')+' & %fnCount & "=" & %fnLine)','next',emit(k+'.count','%fnCount'),'CancelAllRange()'];
 const whole=k=>['SelectAll(1)','%fnLines=GetString(1)','%fnCount=0','foreach %fnLine in %fnLines','%fnCount=%fnCount+1','%result.LinePrint('+q('footnotes.'+k+'.line.')+' & %fnCount & "=" & %fnLine)','next',emit(k+'.count','%fnCount'),'CancelAllRange()'];
 function snapshot(stage,state=plan.states.at(-1)){
  const out=[...at(0),emit(stage+'.bodyArea','GetCursorArea()'),...whole(stage+'.body')];
  for(const note of state.notes){const b=stage+'.note.'+note.id;
   out.push(...at(note.paragraph,note.cursorOffset),emit(b+'.number','GetFootnoteNumber()'),emit(b+'.bodyChar','GetCharacter()'),'JumpFootnote(1,1)',emit(b+'.area','GetCursorArea()'),'CursorLeft(1)','JumpFootnote(2,1)',emit(b+'.returnArea','GetCursorArea()'),emit(b+'.returnNumber','GetFootnoteNumber()'),...at(note.paragraph,note.cursorOffset),'JumpFootnote(1,1)',...readParagraph(b+'.text'),'JumpFootnote(2,0)');
  }
  if(state.notes.length){const n=state.notes[0];out.push(...at(n.paragraph,n.cursorOffset),'JumpFootnote(1,1)',...whole(stage+'.allNotes'),'JumpFootnote(2,0)');}
  else out.push(emit(stage+'.emptyAreaOpen','GetFootnoteArea()'),'if GetFootnoteArea() then','JumpFootnote(1,0)',emit(stage+'.emptyJumpArea','GetCursorArea()'),'if GetCursorArea() = 3 then',...whole(stage+'.emptyNotes'),'JumpFootnote(2,0)','end if','end if');
  out.push(...at(0));return out;
 }
 const apply=snapshot('initial',plan.states[0]);
 for(const [i,op] of plan.trial.steps.entries()){
  const before=plan.states[i],after=plan.states[i+1],b='operation.'+i;
  if(op.action==='add'){
   const offset=op.offset+before.notes.filter(n=>n.paragraph===op.paragraph&&n.offset<op.offset).length;
   apply.push(...at(op.paragraph,offset),'Footnote('+q('%1')+',1)','if GetCursorArea() = 1 then','CursorLeft(1)','JumpFootnote(1,1)','end if',emit(b+'.area','GetCursorArea()'));
   // Mode 2 is the text end, unlike mode 1 which pads to the physical line end.
   apply.push(...readParagraph('prefix.'+op.id));
   apply.push('EndOfLine(2)','Insert('+q(op.text)+')','JumpFootnote(2,0)');
  }else{
   const n=before.notes.find(n=>n.id===op.id);
   apply.push(...at(n.paragraph,n.cursorOffset),emit(b+'.number','GetFootnoteNumber()'));
   if(op.action==='remove')apply.push('if GetCursorArea() = 1 and GetFootnoteNumber() > 0 then','Delete(1)','end if');
   else{
    apply.push('JumpFootnote(1,1)',emit(b+'.area','GetCursorArea()'),'%fnSkip=0','do','if GetCharacter() <> " " then','exit do','end if','CursorRight(1)','%fnSkip=%fnSkip+1','if %fnSkip > 24 then','exit do','end if','loop','%fnOK=1');
    for(const [j,c] of [...n.text].entries())apply.push(emit(b+'.old.'+j,'GetCharacter()'),'if GetCharacter() <> '+q(c)+' then','%fnOK=0','end if','CursorRight(1)');
    apply.push('CursorLeft('+n.text.length+')','if %fnOK = 1 then','Delete('+n.text.length+')','Insert('+q(op.text)+')','end if','JumpFootnote(2,0)');
   }
  }
  apply.push(...snapshot('step-'+(i+1),after));
 }
 return {apply,snapshot};
}
export function verifyFootnoteSequence(meta,{text,trial}){
 const plan=planFootnotes(trial,text),differences=[],snapshots={},checks=[];
 const read=k=>{const v=meta['footnotes.'+k];insist(typeof v==='string','missing getter '+k);return v;};
 const compare=(stage,k,a,e)=>{if(JSON.stringify(a)!==JSON.stringify(e))differences.push({phase:stage,field:k,actual:a,expected:e});};
 const lines=k=>{const n=read(k+'.count');insist(/^\d+$/.test(n)&&+n<=100,'invalid line count');return Array.from({length:+n},(_,i)=>read(k+'.line.'+(i+1)));};
 const prefixes={};for(const [i,op] of plan.trial.steps.entries()){
  if(op.action==='add'){compare('operation-'+i,'area',read('operation.'+i+'.area'),'3');const p=lines('prefix.'+op.id);insist(p.length===1,'one prefix line required');prefixes[op.id]=p[0];}
  else{const n=plan.states[i].notes.find(n=>n.id===op.id);compare('operation-'+i,'number',read('operation.'+i+'.number'),read('step-'+i+'.note.'+op.id+'.number'));if(op.action==='modify'){compare('operation-'+i,'area',read('operation.'+i+'.area'),'3');compare('operation-'+i,'oldText',[...n.text].map((_,j)=>read('operation.'+i+'.old.'+j)).join(''),n.text);}}
 }
 // Accepted note-area labels: the label read right after insertion, the current
 // body-order number, or a number the note held at an earlier stage (the label
 // is not refreshed when an earlier note is removed). %upto is the state index.
 const held=(id,upto)=>plan.states.slice(0,upto+1).flatMap(s=>s.notes.filter(n=>n.id===id).map(n=>n.number));
 let upto=0;
 const accepted=(n,number)=>[...new Set([prefixes[n.id]+n.text,String(number)+n.text,...held(n.id,upto).map(k=>String(k)+n.text)])];
 for(const [stage,state] of [['initial',plan.states[0]],...plan.states.slice(1).map((s,i)=>['step-'+(i+1),s]),['before-save',plan.states.at(-1)],['reopened',plan.states.at(-1)]]){
  upto=plan.states.indexOf(state);
  const body=lines(stage+'.body');compare(stage,'bodyArea',read(stage+'.bodyArea'),'1');const notes=[];
  for(const n of state.notes){const b=stage+'.note.'+n.id,actual={id:n.id,text:lines(b+'.text')};const observedNumber=read(b+'.number');insist(/^[1-8]$/.test(observedNumber),'invalid body note number');if(stage==='reopened')compare(stage,b+'.number',observedNumber,String(n.number));for(const [key,want] of Object.entries({number:observedNumber,bodyChar:stage==='reopened'?observedNumber:read(b+'.bodyChar'),area:'3',returnArea:'1',returnNumber:observedNumber})){actual[key]=read(b+'.'+key);compare(stage,b+'.'+key,actual[key],want);}insist(/^[1-8]$/.test(actual.bodyChar),'invalid displayed note number');
   // The note-area label is display state: isolated documents keep the label read
   // at creation ("*1"), documents that went through header/footer processing show
   // the current body-order number. Membership is proven by the round trips above.
   const label=actual.text.length===1?actual.text[0]:null;
   actual.prefixForm=label===prefixes[n.id]+n.text?'captured':label===String(observedNumber)+n.text?'number':held(n.id,upto).some(k=>label===String(k)+n.text)?'earlier-number':null;
   if(!actual.prefixForm)compare(stage,b+'.text',actual.text,accepted(n,observedNumber));notes.push(actual);}
  const numberedBody=state.body.map((line,p)=>{const chars=[...line];for(const n of state.notes.filter(n=>n.paragraph===p))chars[n.cursorOffset]=notes.find(a=>a.id===n.id).bodyChar;return chars.join('');});compare(stage,'body',body,numberedBody);insist(new Set(notes.map(n=>n.number)).size===notes.length,'duplicate note numbers');
  const allNotes=state.notes.length?lines(stage+'.allNotes'):[];
  if(state.notes.length){if(allNotes.length!==state.notes.length||state.notes.some((n,i)=>!accepted(n,notes[i].number).includes(allNotes[i])))compare(stage,'allNotes',allNotes,state.notes.map((n,i)=>accepted(n,notes[i].number)));}
  else {const opened=read(stage+'.emptyAreaOpen');insist(['TRUE','FALSE'].includes(opened),'invalid note area state');if(opened==='TRUE'){const area=read(stage+'.emptyJumpArea');insist(['1','3'].includes(area),'invalid empty note jump area');if(area==='3')compare(stage,'emptyNotes',lines(stage+'.emptyNotes').join('').trim(),'');}}
  snapshots[stage]={body,notes,allNotes};checks.push({stage,passed:!differences.some(d=>d.phase===stage),strength:'all body paragraphs, per-note round trips, full note text and complete note-area order'});
 }
 return {snapshots,differences,proof:{version:2,trial:plan.trial,prefixes,passed:!differences.length,reopened:!differences.some(d=>d.phase==='reopened'),checks,scope:'Stable original-body paragraph/offset anchors and IDs across add, modify and remove',limitations:['Short horizontal BMP text; max eight active notes; physical layout and style inheritance unverified','Before-save body numbers may be stale until reopen; actual numbers and round trips are compared per stage; reopened ordinal numbers are checked. Visible note prefixes may retain old labels.','Empty note area visibility is recorded, not asserted']}};
}
