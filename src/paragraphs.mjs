// Public sources: T36MAC t26m806d, t26m9nj9, t26m1s9x, t26m5kdk,
// t26m0i91/t26m4m78. Getter keys below reflect genuine-app readback.
export const PARAGRAPH_TARGET_FIELDS=['id','index','expected'];
export const PARAGRAPH_OPERATION_FIELDS=['target','attribute','mode','value','unit'];
export const PARAGRAPH_KEYS=['文字揃え','ｼﾞｬｽﾃｨﾌｨｹｰｼｮﾝ','ｲﾝﾃﾞﾝﾄ行頭','ｲﾝﾃﾞﾝﾄ行末','ｲﾝﾃﾞﾝﾄ先頭行行頭ｼﾌﾄ','ｲﾝﾃﾞﾝﾄ先頭行行末ｼﾌﾄ','ｲﾝﾃﾞﾝﾄ単位','改行幅種類','改行幅','改行幅単位','段落上段落間','段落下段落間','段落間単位','ﾍﾞｰｽ位置','目次ﾚﾍﾞﾙ','行結合','注釈行','一行文字数','段落文字ｻｲｽﾞ','ﾀﾌﾞ位置','ﾀﾌﾞ単位','次段落先頭行結合','ﾀﾌﾞ種類'];
export const PARAGRAPH_ATTRIBUTES={alignment:{slot:0,clear:0,group:[0]},indentStart:{slot:2,clear:2,group:[2,3,4,5,6],unit:6},indentEnd:{slot:3,clear:2,group:[2,3,4,5,6],unit:6},firstStart:{slot:4,clear:2,group:[2,3,4,5,6],unit:6},firstEnd:{slot:5,clear:2,group:[2,3,4,5,6],unit:6},spaceBefore:{slot:10,clear:4,group:[10,11,12],unit:12},spaceAfter:{slot:11,clear:4,group:[10,11,12],unit:12}};
PARAGRAPH_ATTRIBUTES.tabs={slot:19,clear:11,group:[19,20],unit:20};
// Grouped final states: every component of the group is written in one call.
// Omitted components are written as zero, matching the single-component ops.
PARAGRAPH_ATTRIBUTES.indent={slots:{start:2,end:3,firstStart:4,firstEnd:5},clear:2,group:[2,3,4,5,6],unit:6};
PARAGRAPH_ATTRIBUTES.paragraphSpacing={slots:{before:10,after:11},clear:4,group:[10,11,12],unit:12};
// Attributes with exact getters may be combined in one trial (tab positions
// included); getter-less decoration stays a single-attribute trial.
const COMBINABLE=new Set(['alignment','indentStart','indentEnd','firstStart','firstEnd','spaceBefore','spaceAfter','indent','paragraphSpacing','tabs']);
// ParagraphDecoration has no documented getter. Never infer it from these slots.
PARAGRAPH_ATTRIBUTES.decorationLine={group:[],reviewRequired:true};
PARAGRAPH_ATTRIBUTES.decorationColor={group:[],reviewRequired:true};
PARAGRAPH_ATTRIBUTES.decorationFill={group:[],reviewRequired:true};
export const isParagraphDecoration=attribute=>Object.hasOwn(PARAGRAPH_ATTRIBUTES,attribute)&&PARAGRAPH_ATTRIBUTES[attribute].reviewRequired===true;
export function paragraphDecorationCommand(op,q){
 const clear=op.mode==='clear';
 const line=!clear&&op.attribute==='decorationLine'?op.value:1;
 const color=!clear&&op.attribute==='decorationColor'?op.value:'R0G0B0';
 const fill=!clear&&op.attribute==='decorationFill'?op.value:0;
 return `ParagraphDecoration(${clear?0:1},1,1,1,1,${line},${q(color)},2,0,${q('R170G170B170')},2,${fill},${q('R0G0B0')},0,0,0,0)`;
}
const check=(v,m)=>{if(!v)throw new Error('Paragraph recipe: '+m);};
function record(v,keys){check(v&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&!Array.isArray(v),'plain object required');for(const k of Reflect.ownKeys(v))check(typeof k==='string'&&keys.includes(k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'),'unknown or non-data field');}
export function paragraphText(text){check(typeof text==='string','text required');const lines=text.replace(/\r\n|\r/g,'\n').split('\n');check(lines.length>=3&&lines.length<=8&&lines.every(s=>s.length>=1&&s.length<=24&&!/[\x00-\x08\x0a-\x1f\x7f\uD800-\uDFFF\p{M}]/u.test(s)),'3..8 nonempty paragraphs, each 1..24 BMP characters without controls except tabs or combining marks');return lines;}
export function validateParagraphTargets(targets,text){const lines=paragraphText(text),ids=new Set(),positions=new Set();check(Array.isArray(targets)&&targets.length>0&&targets.length<=8,'paragraph targets required');return targets.map(t=>{record(t,PARAGRAPH_TARGET_FIELDS);check(typeof t.id==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(t.id)&&!ids.has(t.id),'unique target ID required');check(Number.isInteger(t.index)&&t.index>=1&&t.index<=lines.length&&!positions.has(t.index),'unique one-based paragraph index required');check(t.expected===lines[t.index-1],'expected paragraph text mismatch');ids.add(t.id);positions.add(t.index);return {...t};});}
export function validateParagraphOperations(ops,targets){check(Array.isArray(ops)&&ops.length<=8,'at most 8 paragraph operations');const active=new Set();let attribute;return ops.map(op=>{record(op,PARAGRAPH_OPERATION_FIELDS);check(targets?.some(t=>t.id===op.target),'unknown paragraph target');check(Object.hasOwn(PARAGRAPH_ATTRIBUTES,op.attribute),'unsupported paragraph attribute');check(!attribute||attribute===op.attribute||COMBINABLE.has(attribute)&&COMBINABLE.has(op.attribute),'single-attribute trials only (alignment, indent and paragraph spacing may be combined)');attribute=op.attribute;check(['set','clear'].includes(op.mode),'set or clear required');if(op.mode==='clear'){check(active.has(op.target),'clear requires prior set');check(op.value===undefined&&op.unit===undefined,'clear takes no value or unit');active.delete(op.target);}else{const d=PARAGRAPH_ATTRIBUTES[op.attribute];if(op.attribute==='tabs'){check(Array.isArray(op.value)&&op.value.length>=1&&op.value.length<=8&&[1,101].includes(op.unit)&&op.value.every((v,i)=>Number.isFinite(v)&&v>0&&v<=(op.unit===1?60:20)&&(!i||v>op.value[i-1])),'ordered tab positions and mm/column unit required');active.add(op.target);return {...op,value:[...op.value]};}if(op.attribute==='decorationColor'){const match=typeof op.value==='string'&&/^R(0|[1-9]\d{0,2})G(0|[1-9]\d{0,2})B(0|[1-9]\d{0,2})$/.exec(op.value);check(match&&match.slice(1).every(v=>Number(v)<=255)&&op.unit===undefined,'canonical RGB components 0..255; no unit');active.add(op.target);return {...op};}if(d.slots){const keys=Object.keys(d.slots),unitOk=[1,d.unit===6?101:100].includes(op.unit);check(op.value&&Object.getPrototypeOf(op.value)===Object.prototype&&Object.keys(op.value).length>=1&&Object.keys(op.value).every(k=>keys.includes(k)),'grouped value requires known components');check(unitOk,'invalid unit');for(const [k,v] of Object.entries(op.value))check(Number.isFinite(v)&&(k==='firstEnd'?v>=-10&&v<=0:v>=0&&v<=(op.unit===100?100:10)),'grouped bounds: firstEnd -10..0, other components nonnegative');active.add(op.target);return {...op,value:{...op.value}};}
check(Number.isFinite(op.value),'numeric value required');if(op.attribute==='decorationFill')check(Number.isInteger(op.value)&&op.value>=0&&op.value<=107&&op.unit===undefined,'fill density 0..100 or pattern 101..107; no unit');else if(op.attribute==='decorationLine')check(Number.isInteger(op.value)&&op.value>=1&&op.value<=15&&op.unit===undefined,'decoration line type 1..15; no unit');else if(op.attribute==='alignment')check([1,2,3,10].includes(op.value)&&op.unit===undefined,'invalid alignment');else{check([1,...(d.unit===6?[101]:[100])].includes(op.unit),'invalid unit');check(op.attribute==='firstEnd'?op.value>=-10&&op.value<=0:op.value>=0&&op.value<=(op.unit===100?100:10),'single-attribute bounds: firstEnd -10..0, other components nonnegative; outside-page shifts are not supported');}active.add(op.target);}return {...op};});}
export function paragraphMacro({text,targets,operations,q}){
 const lines=paragraphText(text);targets=validateParagraphTargets(targets,text);operations=validateParagraphOperations(operations,targets);
 const at=n=>['CancelMode()','CancelAllRange()','JumpStart()',...(n>1?[`NextParagraph(${n-1})`]:[])];
 const select=n=>[...at(n),'RangeMode(3)','RangeStart()','RangeEnd(1,1)'];
 function snapshot(stage){const out=[];for(let n=1;n<=lines.length;n++){
  const prefix=`paragraph.${stage}.${n}.`;out.push(...at(n),'%pa=GetParagraphAttribute()');
  for(const [i,key] of PARAGRAPH_KEYS.entries()){
   out.push(`%paValue=%pa(${q(key)})`,'if IsArray(%paValue) then','%paString="["','%paN=0','foreach %paItem in %paValue','if %paN > 0 then','%paString=%paString & ","','end if','%paString=%paString & %paItem','%paN=%paN+1','next','%paString=%paString & "]"','else','%paString="" & %paValue','end if',`%result.LinePrint(${q(prefix+'field.'+i+'=')} & %paString)`);
  }
  out.push(...at(n));
  for(let k=0;k<lines[n-1].length;k++){
   out.push(`%result.LinePrint(${q(prefix+'char.'+k+'=')} & GetCharacter())`,`%result.LinePrint(${q(prefix+'charType.'+k+'=')} & GetCharacterType())`,'CursorRight(1)');
  }
  out.push(...select(n),'%pt=GetString(1)','%pn=0','foreach %pv in %pt','%pn=%pn+1',`%result.LinePrint(${q(prefix+'text.')} & %pn & "=" & %pv)`,'next',`%result.LinePrint(${q(prefix+'textCount=')} & %pn)`);
 }out.push('CancelMode()','CancelAllRange()');return out;}
 const apply=snapshot('initial');
 for(const [i,op] of operations.entries()){
  const d=PARAGRAPH_ATTRIBUTES[op.attribute],n=targets.find(t=>t.id===op.target).index;apply.push(`%phase="paragraph-step-${i+1}"`,...select(n));
  if(d.reviewRequired)apply.push(paragraphDecorationCommand(op,q));
  else if(op.mode==='clear'){const args=Array(13).fill('false');args[d.clear]='true';apply.push(`CancelParagraphAttribute(${args.join(',')})`);}
  else{const args=Array(Math.max(...d.group)+1).fill('');for(const k of d.group)args[k]=0;if(d.slots){for(const [k,slot] of Object.entries(d.slots))args[slot]=op.value[k]??0;}else args[d.slot]=op.attribute==='tabs'?'{'+op.value.join(',')+'}':op.value;if(d.unit!==undefined)args[d.unit]=op.unit;if(op.attribute==='tabs'){args[21]='';args[22]='{'+op.value.map(()=>1).join(',')+'}';}apply.push(`ParagraphAttribute(${args.join(',')})`);}
  apply.push(...snapshot(`step-${i+1}`));
 }return {apply,snapshot};
}
// ignoreSpaces: only with frames, whose bodies contain no whitespace or tabs; the
// per-character identity check below stays exact.
export function verifyParagraphReadback(meta,{text,targets,operations,ignoreSpaces=false}){
 const lines=paragraphText(text);targets=validateParagraphTargets(targets,text);operations=validateParagraphOperations(operations,targets);
 const snapshots={},differences=[],checks=[];const fail=(phase,field,expected,actual)=>differences.push({phase,field,expected,actual});
 for(const phase of ['initial',...operations.map((_,i)=>`step-${i+1}`),'before-save','reopened']){
  const paragraphs=[];for(let n=1;n<=lines.length;n++){
   const prefix=`paragraph.${phase}.${n}.`,values=PARAGRAPH_KEYS.map((_,k)=>{const v=meta[prefix+'field.'+k];check(typeof v==='string','missing paragraph field '+prefix+k);if([19,22].includes(k)&&v.startsWith('[')){let a;try{a=JSON.parse(v);}catch{}check(Array.isArray(a)&&a.length<=32&&a.every(Number.isFinite),'invalid paragraph array');return a;}check(v===''||/^-?\d+(\.\d+)?$/.test(v),'invalid paragraph field '+prefix+k);return v===''?null:Number(v);});
   const count=Number(meta[prefix+'textCount']);check(Number.isInteger(count)&&count>=1&&count<=24,'missing/invalid paragraph line count');
   const read=[];for(let j=1;j<=count;j++){const v=meta[prefix+'text.'+j];check(typeof v==='string','missing paragraph text line');read.push(v);}
   const characters=[];for(let k=0;k<lines[n-1].length;k++){
    const character=meta[prefix+'char.'+k],kind=meta[prefix+'charType.'+k];check(typeof character==='string'&&/^\d+$/.test(kind??''),'missing character identity getter');
    const expected=lines[n-1][k];
    if(expected==='\t'){if(kind!=='9')fail(phase,`paragraph.${n}.charType.${k}`,9,kind);}
    else if(character!==expected||kind==='9')fail(phase,`paragraph.${n}.char.${k}`,expected,{character,kind});
    characters.push({character,kind:Number(kind)});
   }
   if((ignoreSpaces?read.join('').replaceAll(' ',''):read.join(''))!==lines[n-1].replaceAll('\t',' '))fail(phase,`paragraph.${n}.text`,lines[n-1].replaceAll('\t',' '),read);
   paragraphs.push({index:n,values,textLines:read,characters});
  }snapshots[phase]=paragraphs;
 }
 let expected=snapshots.initial.map(p=>p.values.slice());
 // These recipes start from a fresh unformatted document. Hidden inherited
 // paragraph settings must not be silently treated as a controlled baseline.
 for(const p of snapshots.initial)if(p.values.some(v=>v!==null))fail('initial',`paragraph.${p.index}.attributes`,'all unset',p.values);
 for(const [i,op] of operations.entries()){
  const phase=`step-${i+1}`,d=PARAGRAPH_ATTRIBUTES[op.attribute],index=targets.find(t=>t.id===op.target).index;
  for(const k of d.group)expected[index-1][k]=op.mode==='clear'?null:0;
  if(op.mode==='set'&&d.slots){for(const [k,slot] of Object.entries(d.slots))expected[index-1][slot]=op.value[k]??0;expected[index-1][d.unit]=op.unit;}
  else if(op.mode==='set'&&!d.reviewRequired){expected[index-1][d.slot]=op.value;if(d.unit!==undefined)expected[index-1][d.unit]=op.unit;}
  for(const p of snapshots[phase])for(let k=0;k<PARAGRAPH_KEYS.length;k++)if(JSON.stringify(p.values[k])!==JSON.stringify(expected[p.index-1][k]))fail(phase,`paragraph.${p.index}.${PARAGRAPH_KEYS[k]}`,expected[p.index-1][k],p.values[k]);
  checks.push({stage:phase,operation:op,index,strength:d.reviewRequired?'text-and-unrelated-attributes-only':'exact-numeric-and-unset-all-paragraphs',groupFields:d.group.map(k=>PARAGRAPH_KEYS[k]),passed:!differences.some(d=>d.phase===phase)});
 }
 const last=snapshots[operations.length?`step-${operations.length}`:'initial'];
 // The last paragraph step is read before later elements (columns, frames) are
 // applied, and those may rewrap the paragraphs: GetString(1) returns physical
 // lines (CR-007: three columns split each paragraph into two lines). So the
 // attribute values and the characters are compared exactly, the text as the
 // joined lines; with frames the extra frame space is ignored as well.
 const joined=p=>ignoreSpaces?p.textLines.join('').replaceAll(' ',''):p.textLines.join('');
 for(const phase of ['before-save','reopened'])for(const p of snapshots[phase]){
  const before=last[p.index-1];
  if(JSON.stringify(p.values)!==JSON.stringify(before.values))fail(phase,`paragraph.${p.index}.attributes`,before.values,p.values);
  if(JSON.stringify(p.characters)!==JSON.stringify(before.characters))fail(phase,`paragraph.${p.index}.characters`,before.characters,p.characters);
  if(joined(p)!==joined(before))fail(phase,`paragraph.${p.index}.text`,joined(before),joined(p));
 }
 const reviewRequired=operations.some(op=>PARAGRAPH_ATTRIBUTES[op.attribute].reviewRequired);
 return {snapshots,differences,proof:{version:2,reviewRequired,...(reviewRequired?{decorationVerified:false}:{}),characterIdentityVerified:true,passed:!differences.length&&!reviewRequired,reopened:!differences.some(d=>d.phase==='reopened'),checks,coverage:'every character and tab type, all paragraph texts and 23 attribute getter slots; unset distinguished from zero',limitations:[...(reviewRequired?['Paragraph decoration has no getter: line type, color, fill, presence, removal and outside-target appearance require visual review; the sample remains saved, not verified','clear requests no border and zero fill with ParagraphDecoration(0); this does not prove removal of the internal decoration record; CancelParagraphDecoration is not used because it enters interactive selection']:[]),'single-attribute trials; other components of the same indent/spacing group explicitly fixed to zero','clear removes the complete indent, spacing or tab group','tab positions and unit are checked; tab alignment type is not exposed or verified','GetString renders tabs as one space; GetCharacterType=9 independently required at every requested tab','numeric getter units checked; rendered geometry and character formatting not measured','after the last operation, physical line breaks are layout and are not compared: later columns or frames may rewrap a paragraph (attribute values, characters and the joined text are compared)']}};
}
