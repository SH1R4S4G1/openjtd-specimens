// Layout frames (レイアウトボックス). Public help: LayoutboxCreateMode t26m5mg5,
// LayoutboxStart t26m9zp0, LayoutboxEnd t26m45lw, CreateLayoutbox t26m2beg,
// LayoutboxEditMode t26m47dx, SelectFrame t26m02at, FrameName t26m9h2d,
// SelectFrameName t26m6bs5, GetFramePosition t26m3kfi, GetFrameName t26m68f9,
// GetFrameStyleLayout t26m6984, GetFrameAlignment t26m5w8k, GetFrameDecoration t26m4t9q.
export const FRAME_FIELDS=['frames'];
export const FRAME_ITEM_FIELDS=['name','left','top','width','height','text','writingMode','border'];
const POSITION=['ページ番号','左端','上端','幅','高さ'];
const LAYOUT=['字数','行数','字間','行間','字間行間単位','文字組','字数行数優先'];
const ALIGNMENT=['基準位置','左右位置'];
const DECORATION=['枠飾り','背景設定'];
// Ichitaro snaps frame edges to the layout grid (observed at 10.5pt, 1%/60%
// spacing: at most 1.25mm, e.g. 50→48.75mm, height 30→31.08mm). Requested values
// are asserted within this tolerance; observed values must survive reopen exactly.
export const FRAME_TOLERANCE_MM=2;
// Frames keep a clear gap so snapping never makes them touch.
const FRAME_GAP_MM=7;
const check=(ok,message)=>{if(!ok)throw new Error('Frame recipe: '+message);};
const short=s=>typeof s==='string'&&/^[^\s\p{C}\p{M}\uD800-\uDFFF\u{10000}-\u{10FFFF}]{1,24}$/u.test(s);

// GetString renders a frame-related position in the body as an extra space,
// while GetCharacter shows the body unchanged. Body paragraphs therefore must
// not contain whitespace, and each body character is read individually.
export function frameBodyParagraphs(text){
  const paragraphs=typeof text==='string'?text.replace(/\r\n|\r/g,'\n').split('\n'):[];
  check(paragraphs.length>=1&&paragraphs.length<=8&&paragraphs.every(short),'body must be 1..8 paragraphs of 1..24 non-whitespace BMP characters');
  return paragraphs;
}
export function validateFrames(frames,text){
  frameBodyParagraphs(text);
  check(Array.isArray(frames)&&frames.length>=1&&frames.length<=3,'1..3 frames required');
  const names=new Set();
  const result=frames.map(frame=>{
    check(frame&&Object.getPrototypeOf(frame)===Object.prototype&&Object.keys(frame).every(k=>FRAME_ITEM_FIELDS.includes(k)),'unknown frame field');
    check(typeof frame.name==='string'&&/^[a-z][a-z0-9-]{0,31}$/.test(frame.name)&&!names.has(frame.name),'unique lowercase frame name up to 32 characters');names.add(frame.name);
    for(const [key,min,max] of [['left',10,190],['top',10,280],['width',20,150],['height',15,150]])check(Number.isFinite(frame[key])&&frame[key]>=min&&frame[key]<=max,`${key} must be ${min}..${max} mm`);
    check(frame.left+frame.width<=200&&frame.top+frame.height<=287,'frame must stay on the A4 portrait page');
    check(short(frame.text),'frame text must be 1..24 non-whitespace BMP characters');
    check([1,2].includes(frame.writingMode??1)&&[0,1].includes(frame.border??0),'writingMode 1|2 and border 0|1');
    return {...frame,writingMode:frame.writingMode??1,border:frame.border??0};
  });
  // Selection by name is unambiguous, but overlapping frames would make the
  // snapped geometry depend on creation order. Keep a clear gap.
  for(const [i,a] of result.entries())for(const b of result.slice(i+1))
    check(a.left+a.width+FRAME_GAP_MM<=b.left||b.left+b.width+FRAME_GAP_MM<=a.left||a.top+a.height+FRAME_GAP_MM<=b.top||b.top+b.height+FRAME_GAP_MM<=a.top,'frames must not overlap (7mm gap)');
  return result;
}

export function framesMacro({text,frames,q}){
  frames=validateFrames(frames,text);
  const emit=(key,value)=>`%result.LinePrint(${q(key+'=')} & ${value})`;
  const apply=[];
  for(const [i,f] of frames.entries()){
    apply.push(`%phase="frame-create-${i+1}"`,'CancelMode()','CancelAllRange()','JumpStart()',
      `LayoutboxCreateMode(20,${f.border},${f.writingMode})`,`LayoutboxStart(1,${f.left},${f.top})`,`LayoutboxEnd(${f.left+f.width},${f.top+f.height})`,
      '%frameId=CreateLayoutbox()',emit(`frame.created.${i}.id`,'%frameId'),
      // A new layout box opens in editing mode; type its text before naming it.
      `Insert(${q(f.text)})`,'LayoutboxEditMode(2)','SelectFrame()',`FrameName(${q(f.name)})`,'CancelSelectFrame()');
  }
  function snapshot(stage){
    const out=[];
    for(const [i,f] of frames.entries()){
      const base=`frame.${stage}.${i}.`;
      out.push(`%phase=${q('frame-read-'+stage+'-'+(i+1))}`,'CancelMode()','CancelAllRange()','JumpStart()',`SelectFrameName(${q(f.name)})`,
        emit(base+'name','GetFrameName()'),emit(base+'id','GetFrameID()'),
        '%fr=GetFramePosition()',...POSITION.map((k,n)=>emit(base+'position.'+n,`%fr(${q(k)})`)),
        '%fr=GetFrameStyleLayout()',...LAYOUT.map((k,n)=>emit(base+'layout.'+n,`%fr(${q(k)})`)),
        '%fr=GetFrameAlignment()',...ALIGNMENT.map((k,n)=>emit(base+'alignment.'+n,`%fr(${q(k)})`)),
        '%fr=GetFrameDecoration()',...DECORATION.map((k,n)=>emit(base+'decoration.'+n,`%fr(${q(k)})`)),
        'LayoutboxEditMode(1)','SelectAll(1)','%ft=GetString(1)','%fn=0','foreach %fv in %ft','%fn=%fn+1',`%result.LinePrint(${q(base+'text.')} & %fn & "=" & %fv)`,'next',emit(base+'lines','%fn'),
        'CancelAllRange()','LayoutboxEditMode(2)','CancelSelectFrame()');
    }
    for(const [p,line] of frameBodyParagraphs(text).entries()){
      out.push('CancelMode()','CancelAllRange()','JumpStart()',...(p?[`NextParagraph(${p})`]:[]));
      for(let k=0;k<line.length;k++)out.push(emit(`frame.${stage}.body.${p}.${k}`,'GetCharacter()'),'CursorRight(1)');
    }
    out.push('CancelMode()','CancelAllRange()','JumpStart()');
    return out;
  }
  return {apply,snapshot};
}

export function verifyFrames(meta,{text,frames}){
  frames=validateFrames(frames,text);
  const differences=[],snapshots={},checks=[];
  const read=key=>{if(typeof meta[key]!=='string')throw new Error('Missing frame readback: '+key);return meta[key];};
  const num=key=>{const v=read(key);if(!/^-?\d+(?:\.\d+)?$/.test(v))throw new Error('Invalid frame number: '+key);return Number(v);};
  for(const stage of ['before-save','reopened']){
    snapshots[stage]=frames.map((f,i)=>{
      const base=`frame.${stage}.${i}.`,lines=num(base+'lines');
      if(!Number.isInteger(lines)||lines<1||lines>24)throw new Error('Invalid frame text line count');
      const state={name:read(base+'name'),id:num(base+'id'),
        position:Object.fromEntries(['page','left','top','width','height'].map((k,n)=>[k,num(base+'position.'+n)])),
        layout:Object.fromEntries(LAYOUT.map((k,n)=>[k,read(base+'layout.'+n)])),
        anchor:num(base+'alignment.0'),horizontal:num(base+'alignment.1'),border:num(base+'decoration.0'),background:num(base+'decoration.1'),
        text:Array.from({length:lines},(_,n)=>read(base+'text.'+(n+1))).join('')};
      const fail=(field,expected,actual)=>differences.push({phase:stage,frame:f.name,field,expected,actual});
      if(state.name!==f.name)fail('name',f.name,state.name);
      if(state.position.page!==1)fail('page',1,state.position.page);
      for(const k of ['left','top','width','height'])if(Math.abs(state.position[k]-f[k])>FRAME_TOLERANCE_MM)fail(k,`${f[k]}±${FRAME_TOLERANCE_MM}`,state.position[k]);
      if(state.layout['文字組']!==String(f.writingMode))fail('writingMode',f.writingMode,state.layout['文字組']);
      if(state.anchor!==1)fail('anchor','1 (fixed)',state.anchor);
      if(state.border!==f.border)fail('border',f.border,state.border);
      if(state.text!==f.text)fail('text',f.text,state.text);
      return state;
    });
  }
  const paragraphs=frameBodyParagraphs(text);
  for(const stage of ['before-save','reopened'])for(const [p,line] of paragraphs.entries()){
    const actual=Array.from(line,(_,k)=>read(`frame.${stage}.body.${p}.${k}`)).join('');
    if(actual!==line)differences.push({phase:stage,field:`body.${p}`,expected:line,actual});
  }
  // Snapped geometry and every other observed frame value must survive reopen.
  for(const [i,f] of frames.entries()){
    const before=snapshots['before-save'][i],after=snapshots.reopened[i];
    for(const key of ['position','layout','anchor','horizontal','border','background','text'])
      if(JSON.stringify(before[key])!==JSON.stringify(after[key]))differences.push({phase:'reopened',frame:f.name,field:key,expected:before[key],actual:after[key]});
    checks.push({frame:f.name,requested:{left:f.left,top:f.top,width:f.width,height:f.height},observed:before.position,
      snapMm:Object.fromEntries(['left','top','width','height'].map(k=>[k,Math.round((before.position[k]-f[k])*100)/100])),
      passed:!differences.some(d=>d.frame===f.name)});
  }
  return {snapshots,differences,proof:{version:1,frames,checks,passed:!differences.length,reopened:!differences.some(d=>d.phase==='reopened'),
    bodyCharactersVerified:true,scope:'Each named fixed layout frame on page 1: name, page, position and size, text direction, fixed anchor, border flag and exact frame text before save and after reopen; every body character read with GetCharacter',
    limitations:[`Ichitaro snaps frame edges to the layout grid; requested geometry is asserted within ${FRAME_TOLERANCE_MM}mm and the observed values must be identical after reopen`,
      'Frames are created and selected by name; a count of all frames in the document is not read back','Fixed anchor only; line/character anchored frames, decoration details, background, frame font and wrapping are not set or verified',
      'Frame text is one short line read with GetString; character formatting inside the frame is not verified',
      'GetString shows an extra space in the body where a frame is placed; body identity is proven per character with GetCharacter and the GetString comparison ignores spaces (body paragraphs contain none)']}};
}
