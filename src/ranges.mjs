const check=(ok,message)=>{if(!ok)throw new Error('Range recipe: '+message);};
// Read-back tolerance for ruby sizeMm only (see docs/maintainer/ruby-size-tolerance.md).
export const RUBY_SIZE_TOLERANCE_MM=0.02;
// Text attributes read back exactly from GetCharacterAttribute (probe
// tmp/probe-character-styles-v1.mjs, v2): Bold() and Font(,"太字") both read 太字;
// Font(,"太字斜体") is ignored, so bold and italic cannot be combined by style name.
const FONT_STYLES={regular:'標準',bold:'太字',italic:'斜体'};
const textAttributes={fontStyle:{getter:'和文スタイル名'},fontName:{getter:'和文フォント名'},textColor:{getter:'文字色'}};
const decorations={underline:{getter:'アンダーライン',setter:'Underline'},strikeThrough:{getter:'取消ライン',setter:'StrikeThrough'},border:{getter:'文字囲い',setter:'CharacterBorder'},fill:{getter:'塗りつぶし',setter:'Style'}};
// Shared by input validation and the parameter publication audit.
export const TEXT_TARGET_FIELDS=['id','kind','start','end','expected'];
export const CHARACTER_PARAMETER_FIELDS={
  scaleX:['mode','value'],size:['mode','value'],spacing:['mode','value','unit'],
  closely:['mode'],evenly:['mode','value','unit','widthMode'],
  ruby:['mode','reading','evenly','position','sizeMm','distanceMm','placement'],
  underline:['mode','value','color'],strikeThrough:['mode','value','color'],
  border:['mode','value','color'],fill:['mode','value','color'],
  fontStyle:['mode','value'],textColor:['mode','value'],fontName:['mode','value'],
};
function record(value,keys){
  check(value&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&!Array.isArray(value),'plain object required');
  for(const key of Reflect.ownKeys(value))check(typeof key==='string'&&keys.includes(key)&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'),'unknown or non-data field');
}
// Range offsets count characters of the LF-normalized text; a paragraph break is
// one character and is never itself a target or a per-character readback.
export const RANGE_TEXT_MAX=2000;
// CR-003: a body up to 60000 characters may hold targets, but only the paragraphs
// that contain a target are walked character by character (at most
// RANGE_TEXT_MAX characters in total). The rest of a long body is proven by the
// paragraph walk in src/body-paragraphs.mjs.
export const RANGE_LONG_TEXT_MAX=60000;
export const rangeText=text=>text.replace(/\r\n|\r/g,'\n');
export const characterIndices=text=>[...rangeText(text)].flatMap((c,i)=>c==='\n'?[]:[i]);
const paragraphAt=(text,offset)=>text.slice(0,offset).split('\n').length-1;
/** Paragraph indexes walked by the range readback: all of them up to RANGE_TEXT_MAX characters, otherwise those holding a target. */
export function walkedParagraphs(text,targets){
  text=rangeText(text);const paragraphs=text.split('\n');
  if(text.length<=RANGE_TEXT_MAX)return paragraphs.map((_,p)=>p);
  const walked=[...new Set(targets.map(t=>paragraphAt(text,t.start)))].sort((a,b)=>a-b);
  check(walked.reduce((n,p)=>n+paragraphs[p].length,0)<=RANGE_TEXT_MAX,`in a body over ${RANGE_TEXT_MAX} characters the paragraphs that hold targets must total at most ${RANGE_TEXT_MAX} characters`);
  return walked;
}
export function validateTargets(targets,text){
  check(Array.isArray(targets)&&targets.length>0&&targets.length<=16,'targets must contain 1..16 entries');
  check(typeof text==='string',`range text must be a string`);text=rangeText(text);
  check(text.length>0&&text.length<=RANGE_LONG_TEXT_MAX&&!/[\x00-\x09\x0b-\x1f\x7f\uD800-\uDFFF\p{M}]/u.test(text)&&text.split('\n').every(p=>p.length>0),`range support requires 1..${RANGE_LONG_TEXT_MAX} BMP characters in nonempty paragraphs, without controls other than paragraph breaks or combining marks`);
  const seen=new Set();
  const validated=targets.map(t=>{
    record(t,TEXT_TARGET_FIELDS);
    check(typeof t.id==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(t.id)&&!seen.has(t.id),'unique safe target id required');seen.add(t.id);
    check(t.kind==='text','only text ranges are executable; paragraph and cell targets are pending');
    check(Number.isInteger(t.start)&&Number.isInteger(t.end)&&t.start>=0&&t.end>t.start&&t.end<=text.length,'invalid half-open character offsets');
    check(t.expected===text.slice(t.start,t.end),'expected text does not match offsets');
    check(!t.expected.includes('\n'),'a range must stay inside one paragraph');
    return {...t};
  });
  walkedParagraphs(text,validated); // bounds the per-character walk of a long body
  return validated;
}
export function validateOperations(operations,targets){
  check(Array.isArray(operations)&&operations.length<=8,'operations must be an array of at most 8 steps');
  return operations.map(op=>{
    record(op,['target','type','attribute',...new Set(Object.values(CHARACTER_PARAMETER_FIELDS).flat())]);
    check(targets?.some(t=>t.id===op.target),'unknown target');check(op.type==='character','only character operations implemented');
    check(['scaleX','size','spacing','closely','evenly','ruby',...Object.keys(decorations),...Object.keys(textAttributes)].includes(op.attribute),'unsupported character attribute');
    const rubyFields=CHARACTER_PARAMETER_FIELDS.ruby.filter(field=>field!=='mode');
    if(Object.hasOwn(textAttributes,op.attribute)){
      check(op.mode==='set'&&Object.keys(op).every(k=>['target','type','attribute','mode','value'].includes(k)),'text attributes are set-only with a value');
      if(op.attribute==='fontStyle')check(Object.hasOwn(FONT_STYLES,op.value),'fontStyle must be regular, bold or italic');
      if(op.attribute==='fontName')check(typeof op.value==='string'&&op.value.length>=1&&op.value.length<=64&&!/[\x00-\x1f\x7f\uD800-\uDFFF]/.test(op.value),'fontName must be 1..64 BMP characters');
      if(op.attribute==='textColor'){const m=typeof op.value==='string'&&/^R(\d{1,3})G(\d{1,3})B(\d{1,3})$/.exec(op.value);check(m&&m.slice(1).every(n=>Number(n)<=255),'textColor must be R0..255G0..255B0..255');return {...op,value:`R${Number(m[1])}G${Number(m[2])}B${Number(m[3])}`};}
      return {...op};
    }
    if(Object.hasOwn(decorations,op.attribute)){
      check(['set','clear'].includes(op.mode)&&op.unit===undefined&&op.widthMode===undefined&&rubyFields.every(k=>op[k]===undefined),'invalid decoration mode or fields');
      if(op.mode==='clear')check(op.value===undefined&&op.color===undefined,'decoration clear takes no value/color; shared decoration color is preserved');
      else {
        check(Number.isInteger(op.value)&&op.value>=1&&op.value<=(op.attribute==='fill'?107:15),'invalid line type or fill pattern');
        if(op.color!==undefined){const m=typeof op.color==='string'&&/^R(\d{1,3})G(\d{1,3})B(\d{1,3})$/.exec(op.color);check(m&&m.slice(1).every(n=>Number(n)<=255),'color must be R0..255G0..255B0..255');return {...op,color:`R${Number(m[1])}G${Number(m[2])}B${Number(m[3])}`};}
      }
      return {...op};
    }
    check(op.color===undefined,'color requires decoration attribute');
    if(op.attribute==='ruby'){
      check(['set','modify','clear'].includes(op.mode),'invalid ruby mode');
      check(op.value===undefined&&op.unit===undefined&&op.widthMode===undefined,'ruby uses explicit reading and decoration fields');
      if(op.mode==='clear'){check(rubyFields.every(k=>op[k]===undefined),'ruby clear takes no reading or decoration');return {...op};}
      check(typeof op.reading==='string'&&op.reading.length>0&&op.reading.length<=64&&!/[\x00-\x1f\x7f\uD800-\uDFFF\p{M}]/u.test(op.reading),'ruby reading requires 1..64 BMP characters without controls or combining marks');
      // null explicitly delegates to Sprint; omitted legacy Recipe fields keep their defaults.
      const ruby={evenly:1,position:1,sizeMm:3,distanceMm:0,placement:1,...op};
      check((ruby.evenly===null||[0,1].includes(ruby.evenly))&&(ruby.position===null||[1,2,3].includes(ruby.position))&&(ruby.placement===null||[1,2].includes(ruby.placement)),'invalid ruby placement');
      check((ruby.sizeMm===null||Number.isFinite(ruby.sizeMm)&&ruby.sizeMm>=3&&ruby.sizeMm<=10)&&(ruby.distanceMm===null||Number.isFinite(ruby.distanceMm)&&ruby.distanceMm>=0&&ruby.distanceMm<=10),'ruby application bounds: size 3..10 (documented mm), distance 0..10mm');
      return ruby;
    }
    check(rubyFields.every(k=>op[k]===undefined),'ruby fields require ruby attribute');
    if(['closely','evenly'].includes(op.attribute)){
      const t=targets.find(t=>t.id===op.target);check(t.end-t.start>=2,'allocation needs at least two characters');
      check((op.attribute==='evenly'?['set','modify','clear']:['set','clear']).includes(op.mode),'invalid allocation mode');
      if(op.attribute==='closely'||op.mode==='clear')check(op.value===undefined&&op.unit===undefined&&op.widthMode===undefined,'presence operation takes no width arguments');
      else check(Number.isFinite(op.value)&&Math.abs(op.value)<=100&&[1,2,3,101].includes(op.unit)&&[1,2].includes(op.widthMode)&&(op.widthMode===2||op.value>0),'invalid evenly width (application safety bound: +/-100), unit or widthMode');
      return {...op};
    }
    check(op.widthMode===undefined,'widthMode is only for evenly allocation');
    if(op.attribute==='spacing'){const t=targets.find(t=>t.id===op.target);check(t.end-t.start>=2,'spacing needs at least two characters (internal gaps only)');}
    check(['set','clear'].includes(op.mode),'mode must be set or clear');
    if(op.mode==='clear')check(op.attribute==='spacing'&&op.value===undefined&&op.unit===undefined,'only spacing clear is supported, without value/unit');
    else {
      check(Number.isFinite(op.value),'finite numeric value required');
      if(op.attribute==='spacing')check([1,100].includes(op.unit)&&Math.abs(op.value)<=(op.unit===1?176.4:200),'invalid spacing or unit');
      else check(op.unit===undefined&&op.value>=(op.attribute==='size'?3:50)&&op.value<=(op.attribute==='size'?500:200),'invalid size/scaleX or unexpected unit');
    }
    return {...op};
  }).map((op,index,all)=>{
    if(['evenly','ruby'].includes(op.attribute)){
      const prior=all.slice(0,index).filter(p=>p.attribute===op.attribute),last=prior.findLast(p=>p.target===op.target);
      check(op.mode==='set'?(!last||last.mode==='clear'):(last&&last.mode!=='clear'),'modify/clear requires an active set on the same target; use modify for an existing allocation or ruby');
      const target=targets.find(t=>t.id===op.target);
      for(const p of prior){const other=targets.find(t=>t.id===p.target);check(p.target===op.target||target.end<=other.start||other.end<=target.start,'overlapping targets for the same grouped attribute are not supported');}
    }
    return op;
  });
}

/** Generate only fixed macro commands. GetString consumes the range. */
export function rangeMacro({text,targets,operations,q}){
  text=rangeText(text);const walked=new Set(walkedParagraphs(text,targets));
  // Sequential readback (profile tmp/profile-readback*.mjs): jumping from the
  // document start costs about 33ms per character and a one-character range
  // selection about 27ms, while the getters cost about 3ms. Each paragraph is
  // therefore reached once (CursorRight follows wrapped lines but stops at a
  // paragraph end, probe tmp/probe-cursor-paragraphs-v1.mjs) and then walked
  // with CursorRight(1). Empty cursor slots (after ruby or evenly spacing) read
  // GetCharacter()="" with type 0, matching the old empty selection (probe
  // tmp/probe-cursor-ruby-v1.mjs); a paragraph end reads type 10 and stops the
  // skip so a misaligned walk can only fail the character comparison.
  const paragraphOf=[],localOf=[];{let p=0,k=0;for(const [i,c] of [...text].entries()){if(c==='\n'){p++;k=0;continue;}paragraphOf[i]=p;localOf[i]=k++;}}
  const paragraphs=text.split('\n');
  const indices=characterIndices(text).filter(i=>walked.has(paragraphOf[i]));
  const physicalAt=(paragraph,offset)=>['CancelAllRange()','JumpStart()',...(paragraph?[`NextParagraph(${paragraph})`]:[]),`if ${offset} > 0 then`,`CursorRight(${offset})`,'end if'];
  // %rp<i> is the slot offset of character i inside its paragraph, from the last walk.
  const at=i=>physicalAt(paragraphOf[i],`%rp${i}`);
  const needed=new Set(targets.flatMap(t=>[t.start,t.end-1]));
  const line=(key,expression)=>`%result.LinePrint(${q(key+'=')} & ${expression})`;
  const coordinates='GetPage() & "/" & GetRow() & "/" & GetColumn()';
  function skipEmpty(stage,paragraph,limit){
    // Stop at a character, at a paragraph end (type 10) or at the document end
    // (the last paragraph has no type-10 mark; beyond it CursorRight walks blank space).
    return ['do','%sc=GetCharacter()','if %sc <> "" then','exit do','end if','if GetCharacterType() = 10 then','exit do','end if',
      'if GetPage() = %endPage and GetRow() = %endRow and GetColumn() = %endColumn then','exit do','end if',
      `%result.LinePrint(${q(`range.${stage}.skipped.`)} & (${paragraph*10000} + %off) & "=" & ${coordinates})`,
      'CursorRight(1)','%off=%off+1',`if %off > ${limit} then`,'exit do','end if','loop'];
  }
  function snapshot(stage){
    const lines=['CancelAllRange()','JumpEnd()','%endPage=GetPage()','%endRow=GetRow()','%endColumn=GetColumn()'];
    for(const [p,paragraph] of paragraphs.entries()){
      if(!walked.has(p))continue;
      const limit=paragraph.length+32;
      // The walk over a paragraph is a macro loop: unrolling one block per character
      // made a ~2000-character body a 9MB macro that Ichitaro never started.
      const start=indices.find(i=>paragraphOf[i]===p)??0;
      const add=(name,expression)=>`%pk=%pk & ${q(name+'=')} & ${expression} & Char(31,5)`;
      const addEach=(group,variable)=>['foreach %rv in '+variable,`%pk=%pk & ${q(group+'.')} & ForeachIndex() & "=" & %rv & Char(31,5)`,'next'];
      lines.push('CancelAllRange()','JumpStart()',...(p?[`NextParagraph(${p})`]:[]),'%off=0','%k=0',
        'do',`if %k >= ${paragraph.length} then`,'exit do','end if',...skipEmpty(stage,p,limit),
        // Slot offsets are kept only for characters that operations select.
        ...[...needed].filter(i=>paragraphOf[i]===p).flatMap(i=>[`if %k = ${localOf[i]} then`,`%rp${i}=%off`,'end if']),
        '%pk=""','%ca=GetCharacterAttribute()','%ci=GetCharacterInformation()',
        add('text','GetCharacter()'),add('type','GetCharacterType()'),
        add('position.page','GetPage()'),add('position.row','GetRow()'),add('position.column','GetColumn()'),
        '%gp=GetPosition(1)',...addEach('geometry','%gp'),
        add('info.IsCloselySpacing','IsCloselySpacing()'),add('info.IsEvenlySpacing','IsEvenlySpacing()'),
        ...addEach('attr','%ca'),...addEach('info','%ci'),
        `if %ci(${q('ルビ')}) then`,add('ruby.GetRuby','GetRuby()'),'%rd=GetRubyDecoration()',...addEach('ruby','%rd'),
        'else',add('ruby.GetRuby','""'),'end if',
        `%result.LinePrint(${q(`range.${stage}.`)} & (${start} + %k) & ${q('.packed=')} & %pk)`,'CursorRight(1)','%off=%off+1','%k=%k+1','loop');
      // The slot after the last character must be the paragraph end: no extra character.
      lines.push(...skipEmpty(stage,p,limit),'%atEnd=0','if GetPage() = %endPage and GetRow() = %endRow and GetColumn() = %endColumn then','%atEnd=1','end if',
        line(`range.${stage}.end.${p}`,'GetCharacter() & "/" & GetCharacterType() & "/" & %atEnd & "/" & '+coordinates));
    }
    lines.push('CancelAllRange()');return lines;
  }
  const apply=[...snapshot('initial')];
  operations.forEach((op,index)=>{
    const t=targets.find(t=>t.id===op.target);
    const select=()=>[...at(t.start),'RangeMode(1)','RangeStart()',`CursorRight(%rp${t.end-1}+1-%rp${t.start})`,'RangeEnd(1,1)'];
    apply.push(`%phase="range-operation-${index+1}"`,...at(t.start),line(`range.step-${index+1}.cursor`,coordinates),...select().slice(-4),
      '%ct=GetString(1)','%joined=""','foreach %rv in %ct','%joined=%joined & %rv','next',
      line(`range.step-${index+1}.selected`,'%joined'),`if %joined = ${q(t.expected)} then`,...select());
    if(Object.hasOwn(textAttributes,op.attribute)){
      if(op.attribute==='fontStyle')apply.push(`Font(,${q(FONT_STYLES[op.value])})`);
      else if(op.attribute==='fontName')apply.push(`Font(${q(op.value)})`);
      else apply.push(`CharacterAttribute(,,,,,,,,,${q(op.value)})`);
    }
    else if(Object.hasOwn(decorations,op.attribute)){
      const value=op.mode==='clear'?0:op.value,color=op.color===undefined?'':q(op.color);
      apply.push(op.attribute==='fill'?`Style(,${color},,,,,${value})`:`${decorations[op.attribute].setter}(${value},${color},1)`);
    }
    else if(op.attribute==='ruby'){
      const args=op.mode==='clear'?'':`${q(op.reading)},${op.evenly??''},${op.position??''},,,${op.sizeMm??''},,${op.distanceMm??''},${op.placement??''}`;
      if(op.mode==='modify')apply.push(...at(t.start),`SetRuby(${args})`);
      else apply.push(op.mode==='clear'?'Ruby(0)':`Ruby(1,${args})`);
    }
    else if(op.attribute==='closely')apply.push(`CloselySpacing(${op.mode==='clear'?0:1})`);
    else if(op.attribute==='evenly'){
      // Block mode uses layout columns, not logical character offsets. Select
      // one column inside the last character, away from the preceding allocation.
      // Public CancelEvenlySpacing example t26m27w3 uses this leftward block.
      if(op.mode==='clear')apply.push(...at(t.end-1),'RangeMode(5)','RangeStart()','CursorLeft(1)','RangeEnd(1,1)','%block=GetRange()',
        'foreach %rv in %block',`%result.LinePrint(${q(`range.step-${index+1}.block.`)} & ForeachIndex() & "=" & %rv)`,'next','CancelEvenlySpacing()');
      else if(op.mode==='modify')apply.push(...at(t.start),`ModifyEvenlySpacing(${op.value},${op.unit},${op.widthMode})`);
      else apply.push(`EvenlySpacing(${op.value},${op.unit},${op.widthMode})`);
    }
    else if(op.attribute==='spacing')apply.push(op.mode==='clear'?'CharacterSpace(0)':`CharacterSpace(1,${op.value},${op.unit})`);
    else apply.push(op.attribute==='scaleX'?`CharacterAttribute(,,,,,,${op.value})`:`CharacterAttribute(,,,,${op.value})`);
    // Long bodies produce tens of thousands of lines: append without spreading arguments.
    apply.push('end if');for(const line of snapshot(`step-${index+1}`))apply.push(line);
  });
  return {apply,snapshot};
}

const numeric={scaleX:'横拡大率',size:'文字サイズ',spacing:'字間',unit:'字間単位'};
// Start coordinates of each character from GetPage/GetRow/GetColumn (equal to the
// old one-character GetRange start in tmp/probe-cursor-ruby-v1.mjs).
const positionKeys=['page','row','column'];
const attributeKeys=['和文フォント名','和文スタイル名','欧文フォント名','欧文スタイル名','文字サイズ','縦拡大率','横拡大率','行送り調整','文字色','回転角','傍点','反転','中抜き','影文字','影文字色','アンダーライン','取消ライン','アッパーライン','文字囲い','塗りつぶし','飾り色','字間','字間単位','ベースシフト量','ベースシフト量単位','ベース位置'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function verifyRangeReadback(meta,{text,targets,operations}){
  text=rangeText(text);const walked=walkedParagraphs(text,targets),walkedSet=new Set(walked);
  const paragraphOf=[];{let p=0;for(const [i,c] of [...text].entries()){if(c==='\n')p++;else paragraphOf[i]=p;}}
  const indices=characterIndices(text).filter(i=>walkedSet.has(paragraphOf[i]));const paragraphCount=text.split(String.fromCharCode(10)).length;
  const geometry={},paragraphEnds={};
  const ruby=operations.some(op=>op.attribute==='ruby');
  const allocation=operations.some(op=>['closely','evenly'].includes(op.attribute));
  const stages=['initial',...operations.map((_,i)=>`step-${i+1}`),'before-save','reopened'],snapshots={},differences=[],checks=[],getterDisagreements=[],navigation={};
  const fail=(stage,field,expected,actual)=>differences.push({phase:stage,field,expected,actual});
  for(const stage of stages){
    navigation[stage]={skippedEmptyCursorSlots:Object.keys(meta).filter(k=>k.startsWith(`range.${stage}.skipped.`)).map(k=>Number(k.slice(`range.${stage}.skipped.`.length)))};
    const chars=[];
    for(const i of indices){
      const prefix=`range.${stage}.${i}.`,data={attr:{},info:{},position:{},ruby:{},geometry:{}};
      const store=(tail,value)=>{
        const dot=tail.indexOf('.');
        if(dot<0)data[tail]=value;else{const group=tail.slice(0,dot),name=tail.slice(dot+1).normalize('NFKC');check(['attr','info','position','ruby','geometry'].includes(group),'unknown readback group');check(!Object.hasOwn(data[group],name),'duplicate normalized readback');data[group][name]=value;}
      };
      const packed=meta[prefix+'packed'];
      if(packed!==undefined){for(const field of packed.split('\u001f')){if(!field)continue;const eq=field.indexOf('=');check(eq>0,'malformed packed readback');store(field.slice(0,eq),field.slice(eq+1));}}
      else for(const [key,value] of Object.entries(meta))if(key.startsWith(prefix))store(key.slice(prefix.length),value); // evidence recorded before packing
      check(data.text!==undefined&&Object.keys(data.attr).length>=26&&Object.keys(data.info).length>=3&&Object.keys(data.position).length===3&&data.type!==undefined,'incomplete per-character readback');
      check(attributeKeys.every(k=>Object.hasOwn(data.attr,k)),'missing character attribute');
      for(const key of Object.values(numeric))check(/^-?\d+(?:\.\d+)?$/.test(data.attr[key]??'')&&Number.isFinite(Number(data.attr[key])),'missing/nonnumeric character getter');
      for(const key of positionKeys)check(/^\d+$/.test(data.position[key]??''),'invalid range coordinates');
      check(['ルビ','密着割付','均等割付'].every(k=>/^(TRUE|FALSE)$/.test(data.info[k]??'')),'missing character information flags');
      if(ruby){
        check(typeof data.ruby.GetRuby==='string','missing ruby getter');
        if(data.info['ルビ']==='TRUE'){
          for(const key of ['ルビ文字','均等割付','文字位置','サイズ','距離','ふりがな上下'])check(Object.hasOwn(data.ruby,key),'missing ruby decoration getter: '+key);
          if(data.ruby.GetRuby!==data.ruby['ルビ文字'])fail(stage,`characters.${i}.ruby.reading`,data.ruby.GetRuby,data.ruby['ルビ文字']);
        }
      }
      if(allocation)for(const [key,info] of [['IsCloselySpacing','密着割付'],['IsEvenlySpacing','均等割付']]){
        check(/^(TRUE|FALSE)$/.test(data.info[key]??''),'missing allocation presence getter');
        if(data.info[key]!==data.info[info])getterDisagreements.push({stage,character:i,getter:key,value:data.info[key],characterInformation:data.info[info]});
      }
      if(data.text!==text[i])fail(stage,`characters.${i}.text`,text[i],data.text);
      // X/Y in mm are new readings: recorded, not yet compared.
      (geometry[stage]??={})[i]=data.geometry;delete data.geometry;delete data.type;
      chars[i]=data; // sparse: paragraph breaks have no readback
    }
    // After the last character of each paragraph the walk must reach a slot with
    // no character: an extra character would make the paragraph longer than requested.
    paragraphEnds[stage]=[];
    for(const p of walked){
      const raw=meta[`range.${stage}.end.${p}`];check(typeof raw==='string','missing paragraph end readback');
      const [character,type,atEnd,...coordinates]=raw.split('/');paragraphEnds[stage].push({character,type,atEnd,coordinates:coordinates.join('/')});
      // Middle paragraphs must reach their type-10 mark, the last one the document end:
      // anything else means an extra character or a misaligned walk.
      const reached=p<paragraphCount-1?type==='10'&&atEnd==='0':atEnd==='1';
      if(character!==''||!reached)fail(stage,`paragraph.${p}.end`,p<paragraphCount-1?'paragraph end mark after the last requested character':'document end after the last requested character',raw);
    }
    snapshots[stage]=chars;
  }
  let previous=snapshots.initial;
  operations.forEach((op,index)=>{
    const stage=`step-${index+1}`,current=snapshots[stage],target=targets.find(t=>t.id===op.target),selected=meta[`range.${stage}.selected`];
    if(selected!==target.expected)fail(stage,'selection',target.expected,selected);
    // The walk to the target start must land where the previous readback saw it;
    // the selected string then proves the span.
    const cursor=(meta[`range.${stage}.cursor`]??'').split('/');check(cursor.length===3&&cursor.every(v=>/^\d+$/.test(v)),'missing target cursor coordinates');
    const coordinates=Object.fromEntries(positionKeys.map((k,n)=>[k,cursor[n]]));
    for(const key of positionKeys)if(coordinates[key]!==previous[target.start].position[key])fail(stage,`selection.${key}`,previous[target.start].position[key],coordinates[key]);
    let outside=0,inside=0,terminalGuards=0;const sizeObservations=[];
    for(const i of indices){
      if(i>=target.start&&i<target.end-(op.attribute==='spacing'?1:0)){
        inside++;
        if(Object.hasOwn(textAttributes,op.attribute)){
          const key=textAttributes[op.attribute].getter,value=op.attribute==='fontStyle'?FONT_STYLES[op.value]:op.value;
          if(current[i].attr[key]!==value)fail(stage,`characters.${i}.${op.attribute}`,value,current[i].attr[key]);
          for(const field of Object.keys(previous[i].attr))if(field!==key&&current[i].attr[field]!==previous[i].attr[field])fail(stage,`inside-unrequested.${i}.${field}`,previous[i].attr[field],current[i].attr[field]);
          for(const group of ['info','ruby'])if(!same(current[i][group],previous[i][group]))fail(stage,`inside-unrequested.${i}.${group}`,previous[i][group],current[i][group]);
          continue;
        }
        if(Object.hasOwn(decorations,op.attribute)){
          const key=decorations[op.attribute].getter,value=op.mode==='clear'?0:op.value;
          if(!/^\d+$/.test(current[i].attr[key]??'')||Number(current[i].attr[key])!==value)fail(stage,`characters.${i}.${op.attribute}`,value,current[i].attr[key]);
          if(op.color!==undefined&&current[i].attr['飾り色']!==op.color)fail(stage,`characters.${i}.decorationColor`,op.color,current[i].attr['飾り色']);
          for(const field of Object.keys(previous[i].attr))if(field!==key&&!(field==='飾り色'&&op.color!==undefined)&&current[i].attr[field]!==previous[i].attr[field])fail(stage,`inside-unrequested.${i}.${field}`,previous[i].attr[field],current[i].attr[field]);
          for(const group of ['info','ruby'])if(!same(current[i][group],previous[i][group]))fail(stage,`inside-unrequested.${i}.${group}`,previous[i][group],current[i][group]);
          continue;
        }
        if(op.attribute==='ruby'){
          const present=op.mode!=='clear';
          if(current[i].info['ルビ']!==(present?'TRUE':'FALSE'))fail(stage,`characters.${i}.ruby.presence`,present,current[i].info['ルビ']);
          if(current[i].ruby.GetRuby!==(present?op.reading:''))fail(stage,`characters.${i}.ruby.reading`,present?op.reading:'',current[i].ruby.GetRuby);
          if(present)for(const [field,key] of [['evenly','均等割付'],['position','文字位置'],['sizeMm','サイズ'],['distanceMm','距離'],['placement','ふりがな上下']]){
            if(field==='position'&&current[i].ruby['均等割付']==='1')continue;
            const rubyValid=/^-?\d+(?:\.\d+)?$/.test(current[i].ruby[key]??'');
            if(op[field]===null){
              // Automatic ruby size is returned as NIL (serialized as an empty value).
              // Preserve that state; it is not a measured zero or resolved size.
              if(!rubyValid&&!(field==='sizeMm'&&current[i].ruby[key]===''))fail(stage,`characters.${i}.ruby.${field}`,'numeric value or automatic size NIL',current[i].ruby[key]);
              continue;
            }
            // Ichitaro returns some requested ruby sizes 0.01mm smaller right after setting them (e.g. 3.9→3.89);
            // see docs/maintainer/ruby-size-tolerance.md. Only sizeMm gets a tolerance, and every deviation is recorded.
            const tolerated=field==='sizeMm'&&rubyValid&&Number(current[i].ruby[key])!==op[field]&&Math.abs(Number(current[i].ruby[key])-op[field])<=RUBY_SIZE_TOLERANCE_MM+1e-9;
            if(tolerated)sizeObservations.push({character:i,requestedMm:op[field],actualMm:Number(current[i].ruby[key]),differenceMm:Math.round((Number(current[i].ruby[key])-op[field])*1e6)/1e6});
            if(!rubyValid||(!tolerated&&Number(current[i].ruby[key])!==op[field]))fail(stage,`characters.${i}.ruby.${field}`,op[field],current[i].ruby[key]);
          }
          continue;
        }
        if(['closely','evenly'].includes(op.attribute)){
          const key=op.attribute==='closely'?'IsCloselySpacing':'IsEvenlySpacing',expected=op.mode==='clear'?'FALSE':'TRUE';
          if(current[i].info[key]!==expected)fail(stage,`characters.${i}.${op.attribute}`,expected,current[i].info[key]);
          // Width is intentionally not inferred from presence or font metrics.
          continue;
        }
        const key=numeric[op.attribute],expected=op.mode==='clear'?Number(snapshots.initial[i].attr[key]):op.value;
        if(Number(current[i].attr[key])!==expected)fail(stage,`characters.${i}.${op.attribute}`,expected,current[i].attr[key]);
        if(op.attribute==='spacing'&&op.mode==='set'&&Number(current[i].attr[numeric.unit])!==op.unit)fail(stage,`characters.${i}.spacingUnit`,op.unit,current[i].attr[numeric.unit]);
      }else{
        if(op.attribute==='spacing'&&i===target.end-1)terminalGuards++;else outside++;
        for(const group of ['attr','info','ruby'])if(!same(current[i][group],previous[i][group]))fail(stage,`outside.${i}.${group}`,previous[i][group],current[i][group]);
      }
    }
    const presence=['closely','evenly'].includes(op.attribute);
    checks.push({stage,target:op.target,selection:{start:target.start,end:target.end,expected:target.expected,actual:selected,coordinates},attribute:op.attribute,mode:op.mode,strength:Object.hasOwn(decorations,op.attribute)||Object.hasOwn(textAttributes,op.attribute)?'exact-decoration-and-unrequested-state':op.attribute==='ruby'?'ruby-reading-decoration-and-presence':presence?'dedicated-getter-presence-only-per-character':op.mode==='clear'?'effective-value-equals-initial':'exact-numeric-per-character',...(op.attribute==='ruby'?{applicationDefaultFields:['evenly','position','sizeMm','distanceMm','placement'].filter(k=>op[k]===null),positionApplicable:op.mode!=='clear'&&current[target.start].ruby['均等割付']==='0',...(sizeObservations.length?{sizeMmTolerance:{toleranceMm:RUBY_SIZE_TOLERANCE_MM,reason:'Ichitaro reads back some requested ruby sizes 0.01mm smaller immediately after setting (observed on real hardware: 3.9→3.89); the value is stable across save and reopen',documentedIn:'docs/maintainer/ruby-size-tolerance.md',observations:sizeObservations}}:{})}:{}),...(op.attribute==='evenly'?{widthVerified:false,requestedWidth:op.mode==='clear'?null:{value:op.value,unit:op.unit,widthMode:op.widthMode}}:{}),appliedUnits:op.attribute==='spacing'?'internal-gaps':'characters',insideCharacters:inside,outsideCharacters:outside,terminalGuards,passed:!differences.some(d=>d.phase===stage)});
    previous=current;
  });
  if(!same(previous,snapshots['before-save']))fail('before-save','range-state','last checked state','changed');
  // Paragraph end positions may legitimately move with an operation (for example a
  // larger size); like character positions they must not move after the last operation.
  const lastStage=operations.length?`step-${operations.length}`:'initial';
  if(!same(paragraphEnds[lastStage],paragraphEnds['before-save']))fail('before-save','paragraph-ends',paragraphEnds[lastStage],paragraphEnds['before-save']);
  if(!same(paragraphEnds['before-save'],paragraphEnds.reopened))fail('reopened','paragraph-ends',paragraphEnds['before-save'],paragraphEnds.reopened);
  if(!same(snapshots['before-save'],snapshots.reopened))fail('reopened','range-state','same characters, attributes, flags and coordinates','changed');
  const limitations=[...(allocation?['Allocation presence is checked with dedicated Is* getters; CharacterInformation disagreements are retained, not resolved.','Evenly width and width modification are not verified by presence.']:[]),...(ruby?['Ruby reading and explicit decoration numbers are checked via getters; physical dimensions are not measured. Omitted size can read back NIL: automatic state and persistence are verified, not its resolved numeric size.','Ruby position is applicable only when evenly=0; font/style/color are observed but not configured.',`Ruby sizeMm is matched within ${RUBY_SIZE_TOLERANCE_MM}mm because Ichitaro reads some sizes back 0.01mm smaller (e.g. 3.9→3.89); actual values are recorded in checks[].sizeMmTolerance. See docs/maintainer/ruby-size-tolerance.md.`]:[])];
  return {snapshots,differences,proof:{readback:'sequential-walk-v1',paragraphEnds,geometry,strength:allocation||ruby?'per-operation-strength-and-all-character-outside-check':'exact-numeric-and-all-character-outside-check',coverage:(walked.length===paragraphCount?'all characters of the body':`all characters of paragraphs ${walked.join(',')} (those holding targets in a body over ${RANGE_TEXT_MAX} characters)`)+' (paragraph breaks excluded); captured attributes, ruby getters and character-information flags only',checks,getterDisagreements,navigation,...(limitations.length?{limitations}:{}),reopened:!differences.some(d=>d.phase==='reopened'),passed:differences.length===0}};
}


