import {STRUCTURED_FIELDS,hasStructuredOperations,structuredPlan,structuredMacro,verifyStructuredReadback} from './keisen-structured.mjs';
const ensure=(ok,msg)=>{if(!ok)throw new Error('Keisen recipe: '+msg);};
function record(v,keys){ensure(v&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&!Array.isArray(v),'plain object required');for(const k of Reflect.ownKeys(v))ensure(typeof k==='string'&&keys.includes(k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'),'unknown or non-data field');}
const rgb=v=>typeof v==='string'&&/^R(0|[1-9]\d{0,2})G(0|[1-9]\d{0,2})B(0|[1-9]\d{0,2})$/.test(v)&&v.match(/\d+/g).every(n=>Number(n)<=255);
export const KEISEN_SIDES=['全角上','全角下','半角上','半角下','通常左','通常右','行間左','行間右'];
const cellFields={alignment:'文字揃え',textColor:'文字色',bold:'太字',italic:'斜体',fill:'塗りつぶし',color:'飾り色'};
export const KEISEN_PARAMETER_FIELDS={
 ...STRUCTURED_FIELDS,
 canvas:['rows','columns','leading'],point:['row','column'],leading:['text','size','spacing'],
 line:['type','mode','from','to','lineType','color'],
 table:['type','rows','columns','lineType','color'],
 tableAttribute:['type','attribute','value','cell'],
 tableText:['type','cell','text'],
 tableResize:['type','axis','index','delta'],
 tableRule:['type','axis','boundary','lineType','color'],
 tableDivide:['type','axis','parts'],tableMerge:['type','axis','boundary'],
};
export const KEISEN_CELL_FIELDS=Object.keys(cellFields);
// leading (CR-009): body paragraphs before the canvas, every one with its own text
// (empty: a blank line), optional point size and optional space before/after
// (spacing: before/after with unit 1 mm or 100 percent). A paragraph may wrap over
// several page lines. The text is those paragraphs and then the canvas rows of
// full-width spaces; the canvas (and every table coordinate) starts on the page
// line after the last leading paragraph, which the macro reads at run time.
export function validateKeisenCanvas(v,text){
 record(v,KEISEN_PARAMETER_FIELDS.canvas);ensure(Number.isInteger(v.rows)&&v.rows>=3&&v.rows<=12&&Number.isInteger(v.columns)&&v.columns>=5&&v.columns<=23,'canvas bound: 3..12 rows, 5..23 half-width columns');
 const leading=v.leading===undefined?[]:v.leading;
 ensure(Array.isArray(leading)&&(v.leading===undefined||leading.length>=1)&&leading.length<=8,'leading paragraphs: 1..8 when given');
 const lead=leading.map(p=>{record(p,KEISEN_PARAMETER_FIELDS.leading);ensure(typeof p.text==='string'&&p.text.length<=200&&!/[\s\p{C}\p{M}\uD800-\uDFFF]/u.test(p.text),'leading paragraph text: 0..200 BMP characters without whitespace or controls');
  ensure(p.size===undefined||Number.isFinite(p.size)&&p.size>=6&&p.size<=36,'leading paragraph size: 6..36pt');
  if(p.spacing!==undefined){record(p.spacing,['before','after','unit']);ensure([1,100].includes(p.spacing.unit)&&['before','after'].every(k=>Number.isFinite(p.spacing[k])&&p.spacing[k]>=0&&p.spacing[k]<=(p.spacing.unit===1?10:100)),'leading paragraph spacing: before and after 0..10 mm (unit 1) or 0..100 percent (unit 100)');}
  return {...p,...(p.spacing?{spacing:{...p.spacing}}:{})};});
 const lines=text.replace(/\r\n|\r/g,'\n').split('\n');
 ensure(lines.length===lead.length+v.rows&&lead.every((p,i)=>lines[i]===p.text),'the text must be the leading paragraphs, then the canvas rows');
 ensure(lines.slice(lead.length).every(s=>/^[　]+$/u.test(s)&&s.length>=Math.ceil(v.columns/2)&&s.length<=12),'canvas requires only full-width spaces on every row; visible text is not supported');
 return {...v,...(v.leading!==undefined?{leading:lead}:{})};
}
// Every table coordinate is a page line. With leading paragraphs the canvas row r
// is page line r + %ko, where %ko (the page line before the canvas) is read with
// GetRow() at the start of the canvas; the readback keys stay in canvas rows.
export const KEISEN_OFFSET='%ko';
export function shiftKeisenLines(lines,offset){
 if(!offset)return lines;
 return lines.map(line=>typeof line==='string'?line.replace(/Jump\(1,(\d+|%\w+),/g,(_,row)=>`Jump(1,${row}+${KEISEN_OFFSET},`):line);
}
const toParagraph=i=>['CancelMode()','CancelAllRange()','JumpStart()',...(i?[`NextParagraph(${i})`]:[])];
export const keisenOffsetLines=count=>[...toParagraph(count),`${KEISEN_OFFSET}=GetRow()-1`];
// The leading paragraphs: sizes and spacing are set before the table. At each
// readback stage every paragraph is read from its start: its first and last page
// line (GetRow), its space before/after (GetParagraphAttribute), every character
// (identity, type, size) and the paragraph end (type 10); the top and bottom of its
// first line (GetPosition, mm from the paper's top-left) are recorded, with those
// of the canvas's first line.
function leadingMacro({canvas,q}){
 const lead=canvas.leading??[],line=(key,expr)=>`%result.LinePrint(${q(key+'=')} & ${expr})`,apply=[];
 // Each attribute gets its own selection of the paragraph: CharacterAttribute
 // leaves no range, so a ParagraphAttribute after it under the same selection
 // stopped with 「範囲が設定されていません。」 (CR-011, 0.20.2).
 const select=i=>[...toParagraph(i),'RangeMode(3)','RangeStart()','RangeEnd(1,1)'];
 for(const [i,p] of lead.entries()){
  if(p.size!==undefined&&p.text.length)apply.push(...select(i),`CharacterAttribute(,,,,${p.size})`,'CancelAllRange()');
  if(p.spacing)apply.push(...select(i),`ParagraphAttribute(,,,,,,,,,,${p.spacing.before},${p.spacing.after},${p.spacing.unit})`,'CancelAllRange()');
 }
 function snapshot(stage){
  const a=[];
  const position=key=>['%lp=GetPosition(1)',line(key+'.top',`%lp(${q('Y方向位置')})`),line(key+'.page',`%lp(${q('ページ番号')})`),'%lp=GetPosition(2)',line(key+'.bottom',`%lp(${q('Y方向位置')})`)];
  for(const [i,p] of lead.entries()){
   const pre=`keisen.leading.${stage}.${i+1}`;
   a.push(...toParagraph(i),line(pre+'.startRow','GetRow()'),...position(pre),'%lpa=GetParagraphAttribute()');
   for(const [key,name] of [['spaceBefore','段落上段落間'],['spaceAfter','段落下段落間'],['spaceUnit','段落間単位']])a.push(line(`${pre}.${key}`,`"" & %lpa(${q(name)})`));
   for(let k=0;k<p.text.length;k++)a.push(line(`${pre}.char.${k}`,'GetCharacter()'),line(`${pre}.type.${k}`,'GetCharacterType()'),'%la=GetCharacterAttribute()',line(`${pre}.size.${k}`,`%la(${q('文字サイズ')})`),'CursorRight(1)');
   a.push(line(`${pre}.endType`,'GetCharacterType()'),line(`${pre}.endRow`,'GetRow()'));
  }
  if(lead.length)a.push(...toParagraph(lead.length),line(`keisen.leading.${stage}.canvas.row`,'GetRow()'),...position(`keisen.leading.${stage}.canvas`));
  a.push('CancelMode()','CancelAllRange()');return a;
 }
 return {apply,snapshot};
}
function verifyLeading(meta,canvas){
 const lead=canvas.leading??[],differences=[],snapshots={};if(!lead.length)return null;
 const fail=(stage,field,expected,actual)=>differences.push({phase:stage,field,expected,actual});
 const number=(key,what)=>{const v=meta[key];ensure(/^-?\d+(\.\d+)?$/.test(v??''),`missing ${what} getter ${key}`);return Number(v);};
 const optional=key=>{const v=meta[key];ensure(typeof v==='string','missing leading paragraph getter '+key);return v===''?null:Number(v);};
 for(const stage of ['before-save','reopened']){
  const paragraphs=[];
  const pos=pre=>({top:number(`${pre}.top`,'leading position'),bottom:number(`${pre}.bottom`,'leading position'),page:number(`${pre}.page`,'leading position')});
  for(const [i,p] of lead.entries()){
   const pre=`keisen.leading.${stage}.${i+1}`,characters=[];
   for(let k=0;k<p.text.length;k++){
    const character=meta[`${pre}.char.${k}`],type=meta[`${pre}.type.${k}`],size=meta[`${pre}.size.${k}`];
    ensure(typeof character==='string'&&/^\d+$/.test(type??'')&&/^\d+(\.\d+)?$/.test(size??''),'missing leading character getter '+pre+'.'+k);
    characters.push({character,type:Number(type),size:Number(size)});
    if(character!==p.text[k]||type==='10')fail(stage,`leading.${i+1}.char.${k}`,p.text[k],{character,type:Number(type)});
    if(p.size!==undefined&&Number(size)!==p.size)fail(stage,`leading.${i+1}.size.${k}`,p.size,Number(size));
   }
   const endType=meta[`${pre}.endType`];ensure(/^\d+$/.test(endType??''),'missing leading paragraph end getter');
   if(endType!=='10')fail(stage,`leading.${i+1}.end`,'paragraph end (10) after the text',Number(endType));
   const startRow=number(`${pre}.startRow`,'leading row'),endRow=number(`${pre}.endRow`,'leading row');
   const spacing={before:optional(`${pre}.spaceBefore`),after:optional(`${pre}.spaceAfter`),unit:optional(`${pre}.spaceUnit`)};
   if(p.spacing)for(const key of ['before','after','unit'])if(spacing[key]!==p.spacing[key])fail(stage,`leading.${i+1}.spacing.${key}`,p.spacing[key],spacing[key]);
   // Paragraphs follow each other line by line from the top of the page.
   const expectedStart=i?paragraphs[i-1].endRow+1:1;
   if(startRow!==expectedStart)fail(stage,`leading.${i+1}.startRow`,expectedStart,startRow);
   paragraphs.push({paragraph:i+1,text:p.text,...(p.size!==undefined?{requestedSize:p.size}:{}),...(p.spacing?{requestedSpacing:p.spacing}:{}),startRow,endRow,lines:endRow-startRow+1,spacing,characters,...pos(pre)});
  }
  const canvasRow=number(`keisen.leading.${stage}.canvas.row`,'canvas row');
  if(canvasRow!==paragraphs.at(-1).endRow+1)fail(stage,'leading.canvas.row',paragraphs.at(-1).endRow+1,canvasRow);
  const canvasFirstLine={row:canvasRow,...pos(`keisen.leading.${stage}.canvas`)};
  // Table coordinates are lines of the first page.
  if(canvasFirstLine.page!==1)fail(stage,'leading.canvas.page',1,canvasFirstLine.page);
  snapshots[stage]={paragraphs,canvasFirstLine};
 }
 const strip=snapshot=>snapshot.paragraphs.map(({characters,startRow,endRow,spacing})=>({characters,startRow,endRow,spacing}));
 if(JSON.stringify(strip(snapshots['before-save']))!==JSON.stringify(strip(snapshots.reopened)))fail('reopened','leading','same characters, sizes, rows and spacing as before save','changed');
 const positions=snapshot=>[...snapshot.paragraphs.map(p=>({paragraph:p.paragraph,startRow:p.startRow,endRow:p.endRow,lines:p.lines,top:p.top,bottom:p.bottom})),{canvas:true,row:snapshot.canvasFirstLine.row,top:snapshot.canvasFirstLine.top,bottom:snapshot.canvasFirstLine.bottom}];
 return {differences,snapshots,proof:{version:2,passed:!differences.length,reopened:!differences.some(d=>d.phase==='reopened'),paragraphs:lead.length,
  positions:{beforeSave:positions(snapshots['before-save']),reopened:positions(snapshots.reopened)},
  coverage:'every leading character (identity, type, size), each paragraph end, the page lines each paragraph spans (GetRow) and that they follow each other up to the canvas, and the requested space before/after, before save and after reopening; the top and bottom of each paragraph first line and of the canvas first line recorded (GetPosition, mm)',
  limitations:['The table starts on the page line after the last leading paragraph, read at run time (GetRow), so wrapped paragraphs move it by the lines they span.','Line positions are recorded, not asserted; the requested size and spacing are asserted only when given (otherwise the values are recorded).','Where a paragraph wraps depends on Ichitaro; the characters are checked one by one, line breaks are not requested.']}};
}
export function validateKeisenOperations(ops,canvas){
 if(Array.isArray(ops)&&hasStructuredOperations(ops)){structuredPlan(ops,canvas);return structuredClone(ops);}
 ensure(canvas&&Array.isArray(ops)&&ops.length<=8,'canvas and at most 8 operations required');let table,hasLines=false,hasAttributes=false,hasRules=false;
 const point=p=>{record(p,KEISEN_PARAMETER_FIELDS.point);ensure(Number.isInteger(p.row)&&p.row>=1&&p.row<=canvas.rows&&Number.isInteger(p.column)&&p.column>=1&&p.column<=canvas.columns,'point outside canvas');return {...p};};
 return ops.map(op=>{
  if(op.type==='line'){
   record(op,KEISEN_PARAMETER_FIELDS.line);ensure(!table,'line edits after table creation are not yet supported');const from=point(op.from),to=point(op.to);
   ensure(['draw','change','clear'].includes(op.mode)&&(from.row===to.row)!==(from.column===to.column),'axis-aligned nonempty line required');
   ensure(Math.min(from.row,to.row)>1&&Math.max(from.row,to.row)<canvas.rows&&Math.min(from.column,to.column)>1&&Math.max(from.column,to.column)<canvas.columns,'line must leave a one-point observation margin');
   if(op.mode==='clear')ensure(op.lineType===undefined&&op.color===undefined,'clear takes no lineType/color');else ensure(Number.isInteger(op.lineType)&&op.lineType>=1&&op.lineType<=15&&rgb(op.color),'line type 1..15 and canonical RGB required');
   hasLines=true;return {...op,from,to};
  }
  if(op.type==='table'){
   record(op,KEISEN_PARAMETER_FIELDS.table);ensure(!table&&!hasLines,'one table per sample, without independent line operations');
   for(const [key,max,gap] of [['rows',canvas.rows,2],['columns',canvas.columns,4]])ensure(Array.isArray(op[key])&&op[key].length>=2&&op[key].length<=3&&op[key].every((n,i)=>Number.isInteger(n)&&n>1&&n<max&&(i===0||n-op[key][i-1]>=gap)),'table axes must be ordered, bounded and leave a guard margin');
   ensure(op.columns.every(n=>n%2===1),'table columns must align with full-width character boundaries');
   ensure((op.lineType===null||Number.isInteger(op.lineType)&&op.lineType>=1&&op.lineType<=15)&&(op.color===null||rgb(op.color)),'invalid table line type/color');table={...op,rows:[...op.rows],columns:[...op.columns]};return table;
  }
  if(['tableResize','tableDivide','tableMerge'].includes(op.type))ensure(table?.lineType!==null&&table?.color!==null,'geometry changes require explicit table line type/color');
  if(op.type==='tableResize'){ensure(!hasAttributes&&!hasRules,'resize must precede table attributes and rule changes');table=resizeKeisenTable(table,op,canvas);return {...op};}
  if(['tableDivide','tableMerge'].includes(op.type)){ensure(!hasAttributes&&!hasRules,'topology changes must precede table attributes and rule changes');table=changeKeisenTopology(table,op);return {...op};}
  if(op.type==='tableRule'){tableRuleLine(table,op);hasRules=true;return {...op};}
  if(op.type==='tableText'){
   record(op,KEISEN_PARAMETER_FIELDS.tableText);ensure(table,'tableText requires a table');record(op.cell,KEISEN_PARAMETER_FIELDS.point);
   ensure(Number.isInteger(op.cell.row)&&op.cell.row>=1&&op.cell.row<table.rows.length&&Number.isInteger(op.cell.column)&&op.cell.column>=1&&op.cell.column<table.columns.length,'cell index outside table');
   const capacity=Math.floor((table.columns[op.cell.column]-table.columns[op.cell.column-1])/2)-1;
   ensure(typeof op.text==='string'&&op.text.length<=Math.min(4,capacity)&&!/[\s\p{M}\p{C}\uD800-\uDFFF]/u.test(op.text),'cell text requires short non-whitespace BMP text within the conservative cell capacity; empty text clears');
   hasAttributes=true;return {...op,cell:{...op.cell}};
  }
  record(op,KEISEN_PARAMETER_FIELDS.tableAttribute);ensure(op.type==='tableAttribute'&&table&&Object.hasOwn(cellFields,op.attribute),'tableAttribute requires a previously created table');hasAttributes=true;
  if(op.cell!==undefined){record(op.cell,KEISEN_PARAMETER_FIELDS.point);ensure(Number.isInteger(op.cell.row)&&op.cell.row>=1&&op.cell.row<table.rows.length&&Number.isInteger(op.cell.column)&&op.cell.column>=1&&op.cell.column<table.columns.length,'cell index outside table');}
  const v=op.value;ensure(['textColor','color'].includes(op.attribute)?rgb(v):Number.isInteger(v)&&(op.attribute==='alignment'?[1,2,3,10].includes(v):op.attribute==='fill'?v>=0&&v<=107:[0,1].includes(v)),'invalid table attribute value');return {...op};
 });
}
export function resizeKeisenTable(table,op,canvas){
 record(op,KEISEN_PARAMETER_FIELDS.tableResize);ensure(table&&op.type==='tableResize'&&['row','column'].includes(op.axis),'tableResize requires a table and row/column axis');
 const key=op.axis==='row'?'rows':'columns',axis=table[key],minimum=op.axis==='row'?2:4,limit=canvas[key];
 ensure(Number.isInteger(op.index)&&op.index>=1&&op.index<axis.length,'resize index outside table');
 ensure(Number.isInteger(op.delta)&&op.delta!==0&&Math.abs(op.delta)<=(op.axis==='row'?3:4)&&(op.axis==='row'||op.delta%2===0),'row delta +/-1..3, column delta +/-2 or +/-4 required');
 ensure(axis[op.index]-axis[op.index-1]+op.delta>=minimum,'resize would collapse cell interior');
 const values=axis.map((n,i)=>n+(i>=op.index?op.delta:0));ensure(values.at(-1)<limit,'resized table must leave an observation margin');
 return {...table,rows:[...table.rows],columns:[...table.columns],[key]:values};
}
export function tableRuleLine(table,op){
 record(op,KEISEN_PARAMETER_FIELDS.tableRule);
 ensure(table&&op.type==='tableRule'&&['row','column'].includes(op.axis),'tableRule requires a table and row/column axis');
 const row=op.axis==='row',axis=table[row?'rows':'columns'];
 ensure(Number.isInteger(op.boundary)&&op.boundary>=0&&op.boundary<axis.length,'rule boundary is a zero-based table boundary index');
 ensure(Number.isInteger(op.lineType)&&op.lineType>=1&&op.lineType<=15&&rgb(op.color),'invalid rule line type/color');
 return {type:'line',mode:'change',from:{row:row?axis[op.boundary]:table.rows[0],column:row?table.columns[0]:axis[op.boundary]},
  to:{row:row?axis[op.boundary]:table.rows.at(-1),column:row?table.columns.at(-1):axis[op.boundary]},lineType:op.lineType,color:op.color};
}
export function changeKeisenTopology(table,op){
 record(op,op.type==='tableDivide'?KEISEN_PARAMETER_FIELDS.tableDivide:KEISEN_PARAMETER_FIELDS.tableMerge);
 ensure(table&&['tableDivide','tableMerge'].includes(op.type)&&['row','column'].includes(op.axis),'topology change requires a table and row/column axis');
 const key=op.axis==='row'?'rows':'columns',values=[...table[key]];
 if(op.type==='tableDivide'){
  ensure(op.parts===2&&values.length===2,'divide supports an undivided axis into two parts');
  const middle=(values[0]+values[1])/2,minimum=op.axis==='row'?2:4;
  ensure(Number.isInteger(middle)&&middle-values[0]>=minimum&&(op.axis==='row'||middle%2===1),'equal division requires integral positions and minimum cell interiors');values.splice(1,0,middle);
 }else{ensure(values.length===3&&op.boundary===1,'merge supports the sole internal boundary, never an outer frame');values.splice(1,1);}
 return {...table,rows:[...table.rows],columns:[...table.columns],[key]:values};
}
function cellLineage(before,after){
 const result={};
 for(let r=0;r<after.rows.length-1;r++)for(let c=0;c<after.columns.length-1;c++){
  const parents=[];for(let pr=0;pr<before.rows.length-1;pr++)for(let pc=0;pc<before.columns.length-1;pc++)if(Math.max(after.rows[r],before.rows[pr])<Math.min(after.rows[r+1],before.rows[pr+1])&&Math.max(after.columns[c],before.columns[pc])<Math.min(after.columns[c+1],before.columns[pc+1]))parents.push(`${pr}-${pc}`);
  result[`${r}-${c}`]=parents;
 }return result;
}
export function keisenSegments(op){
 if(op.type==='line')return [[op.from.row,op.from.column,op.to.row,op.to.column]];
 if(op.type==='table')return [...op.rows.map(y=>[y,op.columns[0],y,op.columns.at(-1)]),...op.columns.map(x=>[op.rows[0],x,op.rows.at(-1),x])];return [];
}
function endpoints(op){const out=[];for(const [y,x,yy,xx] of keisenSegments(op))if(y===yy){for(let c=Math.min(x,xx);c<Math.max(x,xx);c++)out.push([y,c,'通常右'],[y,c+1,'通常左']);}else for(let r=Math.min(y,yy);r<Math.max(y,yy);r++)out.push([r,x,'半角下'],[r+1,x,'半角上']);return out;}
const probes=t=>t?t.rows.slice(0,-1).flatMap((y,r)=>t.columns.slice(0,-1).map((x,c)=>({id:`${r}-${c}`,row:y+1,column:x+2,cellColumn:c+1}))):[];
export function keisenMacro({canvas,operations,q}){
 const count=canvas.leading?.length??0,base=tableMacro({canvas,operations,q});
 if(!count)return base;
 const lead=leadingMacro({canvas,q}),offset=keisenOffsetLines(count);
 return {...base,apply:[...lead.apply,...offset,...shiftKeisenLines(base.apply,count)],snapshot:stage=>[...offset,...shiftKeisenLines(base.snapshot(stage),count),...lead.snapshot(stage)]};
}
function tableMacro({canvas,operations,q}){
 if(hasStructuredOperations(operations))return structuredMacro({canvas,operations,q});
 const line=(key,expr)=>`%result.LinePrint(${q(key+'=')} & ${expr})`,apply=[],captureText=operations.some(op=>op.type==='tableText');let table;
 function snapshot(stage,t=table){
  const a=['CancelAllRange()','CancelMode()','KeisenMode(2,1,1)'];
  for(let r=1;r<=canvas.rows;r++)for(let c=1;c<=canvas.columns;c++){
   const pre=`keisen.${stage}.grid.${r}.${c}.`;a.push(`Jump(1,${r},${c})`,'%k=GetPieceOfKeisen()');
   for(const s of KEISEN_SIDES)for(const f of ['線種','線色','背景色'])a.push(line(pre+s+'.'+f,`%k(${q(s)},${q(f)})`));
   for(const s of ['全角上','全角下','半角上','半角下'])a.push(line(pre+s+'面取り',`%k(${q(s+'面取り')})`));
  }
  if(t)a.push(line(`keisen.${stage}.cellGetterMode`,q('normal-editing')));
  // In drawing mode this getter can describe the mode's current attributes,
  // rather than the cell under the cursor. Navigate in normal editing mode:
  // leaving drawing mode at a blank right-aligned cell can land on its border.
  for(const p of probes(t)){a.push('CancelMode()',`Jump(1,${p.row},1)`,`RightCell(${p.cellColumn})`,'%a=GetKeisenAttribute()');for(const k of Object.values(cellFields))a.push(line(`keisen.${stage}.table.${p.id}.${k}`,`%a(${q(k)})`));}
  if(captureText)for(const p of probes(t)){
   a.push('CancelAllRange()','CancelMode()',`Jump(1,${p.row},1)`,`RightCell(${p.cellColumn})`,'RangeMode(7)','RangeStart()','RangeEnd(1,1)','%cellText=GetString(2)','%textCount=0','foreach %v in %cellText','%textCount=%textCount+1',`%result.LinePrint(${q(`keisen.${stage}.text.${p.id}.line.`)} & %textCount & "=" & %v)`,'next',line(`keisen.${stage}.text.${p.id}.count`,'%textCount'),'CancelAllRange()');
  }
  a.push('CancelMode()');return a;
 }
 apply.push(...snapshot('initial'));
 operations.forEach((op,i)=>{
  apply.push(`%phase="keisen-step-${i+1}"`);
  if(op.type==='tableDivide'){
   const name=op.axis==='row'?'Line':'Column';
   apply.push('CancelMode()','KeisenMode(2,1,1)',`Jump(1,${table.rows[0]},${table.columns[0]})`,'KeisenStart()',`Jump(1,${table.rows.at(-1)},${table.columns.at(-1)})`,`Keisen${name}Divide(${table.lineType},${q(table.color)})`,'KeisenEnd()',`Keisen${name}DivideEqually(2)`,`Keisen(1,${table.lineType},${q(table.color)})`,'CancelMode()');
   table=changeKeisenTopology(table,op);
  }else if(op.type==='tableMerge'){
   const row=op.axis==='row',y=row?table.rows[op.boundary]:table.rows[0],x=row?table.columns[0]:table.columns[op.boundary];
   apply.push('CancelMode()','KeisenMode(2,1,1)',`Jump(1,${y},${x})`,'KeisenStart()',`Jump(1,${row?y:table.rows.at(-1)},${row?table.columns.at(-1):x})`,'KeisenEnd()','Keisen(0)','CancelMode()');table=changeKeisenTopology(table,op);
  }else if(op.type==='tableResize'){
   const row=op.axis==='row',name=row?'Line':'Column',start=row?table.rows[op.index-1]+1:table.columns[op.index-1]+2,end=start+Math.abs(op.delta)-1;
   const y=row?start:table.rows[0]+1,x=row?table.columns[0]:start;
   apply.push('CancelMode()',`KeisenModify${name}Mode(${op.delta>0?1:2},${row?1:2})`,`Jump(1,${y},${x})`,`KeisenModify${name}Start()`,`Jump(1,${row?end:y},${row?x:end})`,`KeisenModify${name}End()`,`KeisenModify${name}(1${row?'':',1'})`,'CancelMode()');
   table=resizeKeisenTable(table,op,canvas);
  }else if(op.type==='tableText'){
   const p=probes(table).find(p=>p.id===`${op.cell.row-1}-${op.cell.column-1}`);
   apply.push('CancelAllRange()','CancelMode()',`Jump(1,${p.row},1)`,`RightCell(${p.cellColumn})`,'RangeMode(7)','RangeStart()','RangeEnd(1,1)',
    '%sel=GetRange()','foreach %v in %sel',`%result.LinePrint(${q(`keisen.step-${i+1}.selection.`)} & ForeachIndex() & "=" & %v)`,'next',
    'EraseKeisenCell()','CancelAllRange()',`Jump(1,${p.row},1)`,`RightCell(${p.cellColumn})`,...(op.text?[`Insert(${q(op.text)})`]:[]));
  }else if(op.type==='tableAttribute'){
   const p=op.cell?probes(table).find(p=>p.id===`${op.cell.row-1}-${op.cell.column-1}`):probes(table)[0],args=Object.keys(cellFields).map(k=>k===op.attribute?(typeof op.value==='string'?q(op.value):op.value):'');while(args.at(-1)==='')args.pop();
   apply.push('CancelMode()',...(op.cell?[`Jump(1,${p.row},1)`,`RightCell(${p.cellColumn})`,'RangeMode(7)','RangeStart()','RangeEnd(1,1)']:[`Jump(1,${p.row},${(p.column+1)/2})`,'SelectAll(1)']),'%sel=GetRange()','foreach %v in %sel',`%result.LinePrint(${q(`keisen.step-${i+1}.selection.`)} & ForeachIndex() & "=" & %v)`,'next',`SetKeisenAttribute(${args.join(',')})`,'CancelAllRange()');
  }else{
   for(const [y,x,yy,xx] of keisenSegments(op.type==='tableRule'?tableRuleLine(table,op):op)){
    const change=op.type==='tableRule'||op.type==='line'&&op.mode==='change';
    apply.push('CancelMode()',change?'KeisenChangeMode(2,1)':'KeisenMode(2,1,1)',`Jump(1,${y},${x})`,change?'KeisenChangeStart()':'KeisenStart()',`Jump(1,${yy},${xx})`,change?'KeisenChangeEnd()':'KeisenEnd()',change?`KeisenChange(1,${op.lineType},${q(op.color)},2)`:op.mode==='clear'?'Keisen(0)':`Keisen(1,${op.lineType??''},${op.color===null?'':q(op.color)})`,'CancelMode()');
   }
   if(op.type==='table')table=op;
  }
  apply.push(...snapshot(`step-${i+1}`));
 });
 return {apply,snapshot};
}
export function verifyKeisenReadback(meta,{canvas,operations}){
 const result=verifyTableReadback(meta,{canvas,operations}),leading=verifyLeading(meta,canvas);
 if(!leading)return result;
 const differences=[...result.differences,...leading.differences];
 for(const stage of ['before-save','reopened'])result.snapshots[stage]={...result.snapshots[stage],leading:leading.snapshots[stage]};
 return {...result,differences,proof:{...result.proof,passed:result.proof.passed&&leading.proof.passed,reopened:result.proof.reopened&&leading.proof.reopened,leadingProof:leading.proof}};
}
function verifyTableReadback(meta,{canvas,operations}){
 if(hasStructuredOperations(operations))return verifyStructuredReadback(meta,{canvas,operations});
 const stages=['initial',...operations.map((_,i)=>`step-${i+1}`),'before-save','reopened'],snapshots={},differences=[],checks=[],captureText=operations.some(op=>op.type==='tableText');let table;
 const fail=(stage,field,expected,actual)=>differences.push({phase:stage,field,expected,actual});
 for(const [index,stage] of stages.entries()){
  if(index>0&&operations[index-1]?.type==='table')table=operations[index-1];
  if(index>0&&operations[index-1]?.type==='tableResize')table=resizeKeisenTable(table,operations[index-1],canvas);
  if(index>0&&['tableDivide','tableMerge'].includes(operations[index-1]?.type))table=changeKeisenTopology(table,operations[index-1]);
  const grid={},cells={};
  if(table)ensure(meta[`keisen.${stage}.cellGetterMode`]==='normal-editing','normal-editing cell getter evidence required');
  for(let r=1;r<=canvas.rows;r++)for(let c=1;c<=canvas.columns;c++){
   for(const s of KEISEN_SIDES)for(const f of ['線種','線色','背景色']){const key=`${r}.${c}.${s}.${f}`,v=meta[`keisen.${stage}.grid.${key}`];ensure(f==='線色'?rgb(v):/^\d+$/.test(v??''),'missing/invalid grid getter '+stage+'.'+key);grid[key]=v;}
   for(const s of ['全角上','全角下','半角上','半角下']){const key=`${r}.${c}.${s}面取り`,v=meta[`keisen.${stage}.grid.${key}`];ensure(/^[01]$/.test(v??''),'missing chamfer getter');grid[key]=v;}
  }
  for(const p of probes(table)){cells[p.id]={};for(const f of Object.values(cellFields)){const v=meta[`keisen.${stage}.table.${p.id}.${f}`];ensure(typeof v==='string'&&(f.endsWith('色')?rgb(v):/^\d+$/.test(v)),'missing table getter');cells[p.id][f]=v;}}
  const texts={};
  if(captureText)for(const p of probes(table)){
   const prefix=`keisen.${stage}.text.${p.id}.`;ensure(meta[prefix+'count']==='1','cell text must have exactly one getter element');
   ensure(typeof meta[prefix+'line.1']==='string','missing cell text getter');texts[p.id]=meta[prefix+'line.1'];
  }
  snapshots[stage]={grid,cells,...(captureText?{texts}:{}),...(table?{table:{rows:table.rows,columns:table.columns}}:{})};
 }
 let previous=snapshots.initial,previousTable;
 for(const [key,value] of Object.entries(previous.grid))if(!key.endsWith('線色')&&value!=='0')fail('initial',key,'0 (blank canvas)',value);
 operations.forEach((op,i)=>{
  const stage=`step-${i+1}`,current=snapshots[stage],expected={...previous.grid},ignored=new Set();
  const topology=['tableDivide','tableMerge'].includes(op.type),geometryChange=topology||op.type==='tableResize';
  if(geometryChange){
   for(const [r,c,s] of endpoints(previousTable)){const pre=`${r}.${c}.${s}.`;expected[pre+'線種']='0';expected[pre+'背景色']='0';ignored.add(pre+'線色');}
   previousTable=topology?changeKeisenTopology(previousTable,op):resizeKeisenTable(previousTable,op,canvas);
   for(const [r,c,s] of endpoints(previousTable)){const pre=`${r}.${c}.${s}.`;expected[pre+'線種']=String(previousTable.lineType);expected[pre+'背景色']='0';expected[pre+'線色']=previousTable.color;ignored.delete(pre+'線色');}
  }
  if(op.type==='table')previousTable=op;
  for(const [r,c,s] of endpoints(op.type==='tableRule'?tableRuleLine(previousTable,op):op)){const pre=`${r}.${c}.${s}.`;expected[pre+'線種']=String(op.mode==='clear'?0:op.lineType);if(op.type==='table'&&op.lineType===null){if(!/^(?:[1-9]|1[0-6])$/.test(current.grid[pre+'線種']))fail(stage,pre+'線種','visible application-selected line',current.grid[pre+'線種']);expected[pre+'線種']=current.grid[pre+'線種'];}expected[pre+'背景色']='0';if(op.mode==='clear')ignored.add(pre+'線色');else expected[pre+'線色']=op.type==='table'&&op.color===null?current.grid[pre+'線色']:op.color;}
  for(const [key,value] of Object.entries(expected))if(!ignored.has(key)&&current.grid[key]!==value)fail(stage,key,value,current.grid[key]);
  const lineage=topology?cellLineage(previous.table,current.table):undefined;
  if(topology){for(const [id,parents] of Object.entries(lineage))for(const parent of parents)for(const [k,v] of Object.entries(previous.cells[parent]))if(current.cells[id]?.[k]!==v)fail(stage,`table.${id}.${k}`,v,current.cells[id]?.[k]);}
  else if(op.type!=='table')for(const [id,attrs] of Object.entries(previous.cells))for(const [k,v] of Object.entries(attrs)){const targeted=!op.cell||id===`${op.cell.row-1}-${op.cell.column-1}`;const want=op.type==='tableAttribute'&&targeted&&k===cellFields[op.attribute]?String(op.value):v;if(current.cells[id]?.[k]!==want)fail(stage,`table.${id}.${k}`,want,current.cells[id]?.[k]);}
  if(captureText)for(const [id,text] of Object.entries(current.texts)){
   const want=op.type==='tableText'&&id===`${op.cell.row-1}-${op.cell.column-1}`?op.text:(previous.texts[id]??'');
   if(text!==want)fail(stage,`text.${id}`,want,text);
  }
  let selection;
  if(op.cell){
   selection={};const pre=`keisen.${stage}.selection.`;for(const [k,v] of Object.entries(meta))if(k.startsWith(pre))selection[k.slice(pre.length).normalize('NFKC')]=v;
   for(const k of ['始点ページ','始点行','始点桁','終点ページ','終点行','終点桁','単位'])ensure(/^[1-9]\d*$/.test(selection[k]??''),'missing cell selection coordinates');
   for(const [k,v] of [['始点ページ','1'],['終点ページ','1'],['単位','7']])if(selection[k]!==v)fail(stage,`selection.${k}`,v,selection[k]);
  }
  checks.push({stage,...(op.type==='table'?{applicationDefaultFields:['lineType','color'].filter(k=>op[k]===null)}:{}),type:op.type,mode:op.mode,attribute:op.attribute,cell:op.cell,selection,...(op.type==='tableRule'?{axis:op.axis,boundary:op.boundary,lineType:op.lineType,color:op.color,segment:tableRuleLine(previousTable,op)}:{}),...(geometryChange?{axis:op.axis,index:op.index,delta:op.delta,parts:op.parts,boundary:op.boundary,tableBefore:previous.table,tableAfter:current.table,cellLineage:lineage}:{}),strength:op.type==='tableText'?'exact-cell-text-and-outside-cells-attributes-grid':op.type==='tableAttribute'?'exact-target-and-outside-cell-probes-and-grid':op.type==='table'&&(op.lineType===null||op.color===null)?'exact-topology-explicit-attributes-and-observed-defaults':'exact-segment-topology-type-color-and-grid',gridPoints:canvas.rows*canvas.columns,tableScope:op.type==='tableAttribute'?(op.cell?'single-cell':'whole-single-table'):undefined,passed:!differences.some(d=>d.phase===stage)});previous=current;
 });
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 if(!same(previous,snapshots['before-save']))fail('before-save','state','last checked state','changed');
 if(!same(snapshots['before-save'],snapshots.reopened))fail('reopened','state','same grid and table getters','changed');
 return {snapshots,differences,proof:{version:captureText?3:2,...(captureText?{textVerified:true}:{}),cellGetterMode:'normal-editing',passed:!differences.length,reopened:!differences.some(d=>d.phase==='reopened'),checks,coverage:'bounded page-1 grid, 8 directions at every point, chamfers and normal-mode cell probes in one table',limitations:[captureText?'Short cell text checked exactly at every stage; body whitespace is not preserved.':'Blank canvas only; body whitespace is checked, exact text is not preserved.','Outside the bounded grid is not observed.','Half-width columns and normal-row positions only; geometry in mm is not measured.','One interior probe per cell; resize inserts/deletes interior space without changing cell counts. Equal two-way division and whole internal-boundary merging only; arbitrary cell insertion is pending.']}};
}


