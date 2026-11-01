// Final-state document-local character/paragraph styles. Public help:
// EntryCharacterStyle t26m1kkl, EntryParagraphStyle t26m7zol, CharacterStyle
// t26m9v1h, SetParagraphStyle t26m07vp, GetCharacterStyleList t26m7flg,
// GetParagraphStyleName t26m25np, GetCharacterPoint t26m5y7o.
// The history trial (define/apply/direct/redefine/clear) stays in named-styles.mjs.
export const STYLE_DEFINITION_FIELDS=['definitions','applications'];
export const STYLE_ITEM_FIELDS=['kind','name','sizePt','paragraph','style'];
const check=(ok,message)=>{if(!ok)throw new Error('Style definitions: '+message);};
const short=s=>typeof s==='string'&&/^[^\s\p{C}\p{M}\uD800-\uDFFF\u{10000}-\u{10FFFF}]{1,24}$/u.test(s);
const plain=v=>v&&Object.getPrototypeOf(v)===Object.prototype;

export function styleParagraphs(text){
  const paragraphs=typeof text==='string'?text.replace(/\r\n|\r/g,'\n').split('\n'):[];
  check(paragraphs.length>=1&&paragraphs.length<=8&&paragraphs.every(short),'body must be 1..8 paragraphs of 1..24 non-whitespace BMP characters');
  return paragraphs;
}
export function validateStyleDefinitions(value,text){
  const paragraphs=styleParagraphs(text);
  check(plain(value)&&Object.keys(value).every(k=>STYLE_DEFINITION_FIELDS.includes(k)),'definitions and applications required');
  check(Array.isArray(value.definitions)&&value.definitions.length>=1&&value.definitions.length<=4,'1..4 definitions');
  const names=new Set();
  const definitions=value.definitions.map(d=>{
    check(plain(d)&&Object.keys(d).every(k=>['kind','name','sizePt'].includes(k)),'definition fields kind, name, sizePt');
    check(['character','paragraph'].includes(d.kind),'kind must be character or paragraph');
    // ASCII names avoid colliding with Ichitaro's localized system style names.
    check(typeof d.name==='string'&&/^[A-Za-z][A-Za-z0-9]{0,15}$/.test(d.name)&&!names.has(d.name),'unique ASCII name, 1..16 characters');names.add(d.name);
    check(Number.isFinite(d.sizePt)&&d.sizePt>=6&&d.sizePt<=36&&Number.isInteger(d.sizePt*2),'sizePt 6..36 in 0.5pt steps');
    return {kind:d.kind,name:d.name,sizePt:d.sizePt};
  });
  check(Array.isArray(value.applications??[])&&(value.applications??[]).length<=8,'at most 8 applications');
  const used=new Set();
  const applications=(value.applications??[]).map(a=>{
    check(plain(a)&&Object.keys(a).every(k=>['paragraph','style'].includes(k)),'application fields paragraph, style');
    check(Number.isInteger(a.paragraph)&&a.paragraph>=0&&a.paragraph<paragraphs.length&&!used.has(a.paragraph),'one style per existing zero-based paragraph');used.add(a.paragraph);
    check(definitions.some(d=>d.name===a.style),'application must name a definition');
    return {paragraph:a.paragraph,style:a.style};
  }).sort((a,b)=>a.paragraph-b.paragraph);
  return {definitions,applications};
}

export function styleDefinitionsMacro({text,trial,q}){
  trial=validateStyleDefinitions(trial,text);const paragraphs=styleParagraphs(text);
  const at=n=>['CancelMode()','CancelAllRange()','JumpStart()',...(n?[`NextParagraph(${n})`]:[])];
  const emit=(key,value)=>`%result.LinePrint(${q(key+'=')} & ${value})`;
  function snapshot(stage){
    const b=`styles.${stage}.`,out=['CancelAllRange()'];
    for(const kind of ['Character','Paragraph'])out.push(`%stList=Get${kind}StyleList(1)`,'%stN=0','foreach %stV in %stList','%stN=%stN+1',`%result.LinePrint(${q(b+kind.toLowerCase()+'.')} & %stN & "=" & %stV)`,'next',emit(b+kind.toLowerCase()+'Count','%stN'));
    for(const [p,line] of paragraphs.entries()){out.push(...at(p));for(let k=0;k<line.length;k++){const key=`${b}${p}.${k}.`;out.push('%stA=GetCharacterAttribute()',emit(key+'char','GetCharacter()'),emit(key+'point','GetCharacterPoint()'),emit(key+'direct',`%stA(${q('文字サイズ')})`),emit(key+'paragraphStyle','GetParagraphStyleName()'),'CursorRight(1)');}}
    out.push(...at(0));return out;
  }
  const apply=['%phase="styles"',...snapshot('initial')];
  for(const d of trial.definitions)apply.push(`Entry${d.kind==='character'?'Character':'Paragraph'}Style(${q(d.name)},,,,,${d.sizePt})`);
  for(const a of trial.applications){const d=trial.definitions.find(x=>x.name===a.style);apply.push(...at(a.paragraph),'RangeMode(3)','RangeStart()','RangeEnd(1,1)',d.kind==='character'?`CharacterStyle(${q(d.name)})`:`SetParagraphStyle(1,${q(d.name)})`,'CancelAllRange()');}
  return {apply,snapshot};
}

export function verifyStyleDefinitions(meta,{text,trial,baseSize=10.5}){
  trial=validateStyleDefinitions(trial,text);const paragraphs=styleParagraphs(text);
  const differences=[],snapshots={},checks=[];
  const read=k=>{if(typeof meta[k]!=='string')throw new Error('Missing style readback: '+k);return meta[k];};
  const list=(b,kind)=>{const n=read(b+kind+'Count');if(!/^\d+$/.test(n)||+n>1000)throw new Error('Invalid style list count');return Array.from({length:+n},(_,i)=>read(`${b}${kind}.${i+1}`));};
  const eq=(phase,field,actual,expected)=>{if(JSON.stringify(actual)!==JSON.stringify(expected))differences.push({phase,field,expected,actual});};
  const number=v=>String(Number(v));
  for(const stage of ['initial','before-save','reopened']){
    const b=`styles.${stage}.`,state={character:list(b,'character'),paragraph:list(b,'paragraph'),paragraphs:[]};
    if(stage==='initial'){for(const d of trial.definitions)check(!state[d.kind].includes(d.name),`style ${d.name} already exists in the document`);}
    else for(const kind of ['character','paragraph'])eq(stage,`${kind}Registry`,[...state[kind]].sort(),[...snapshots.initial[kind],...trial.definitions.filter(d=>d.kind===kind).map(d=>d.name)].sort());
    for(const [p,line] of paragraphs.entries()){
      const applied=stage==='initial'?null:trial.applications.find(a=>a.paragraph===p);
      const style=applied&&trial.definitions.find(d=>d.name===applied.style);
      const chars=Array.from(line,(char,k)=>{const key=`${b}${p}.${k}.`,actual={char:read(key+'char'),point:read(key+'point'),direct:read(key+'direct'),paragraphStyle:read(key+'paragraphStyle')};
        // The effective size proves the definition's size. The character attribute
        // size is not the document base size (12pt documents still report 10.5), so it
        // must simply be unchanged from before the styles were defined and applied.
        const initialDirect=stage==='initial'?actual.direct:snapshots.initial.paragraphs[p][k].direct;
        eq(stage,`${p}.${k}`,{char:actual.char,point:number(actual.point),direct:number(actual.direct),paragraphStyle:actual.paragraphStyle},
          {char,point:number(style?style.sizePt:baseSize),direct:number(initialDirect),paragraphStyle:style?.kind==='paragraph'?style.name:''});
        return actual;});
      state.paragraphs.push(chars);
    }
    snapshots[stage]=state;if(stage!=='initial')checks.push({stage,passed:!differences.some(d=>d.phase===stage)});
  }
  return {snapshots,differences,proof:{version:1,trial,baseSize,checks,passed:!differences.length,reopened:!differences.some(d=>d.phase==='reopened'),
    scope:'Document-local character/paragraph style definitions (name and size) and their application to whole paragraphs: registry names, every character effective size (GetCharacterPoint), character attribute size unchanged from before the styles, and paragraph style name before save and after reopen',
    limitations:['Only the size of a definition is set; an unapplied definition is verified by name only','Character style assignment has no name getter; it is proven by the effective size of every character','One style per paragraph, whole paragraphs only; character and paragraph styles are not stacked and inheritance between styles is not set','System style registration is never used; document-local only']}};
}
