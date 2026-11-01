import {createTableGeometry,cellAt,mergeTableCells,splitTableCell,changeTableBand,tableGeometrySegments} from './table-geometry.mjs';

export const STRUCTURED_FIELDS={tableBand:['type','axis','mode','index','size'],cellMerge:['type','from','to'],cellSplit:['type','cell','rows','columns']};
// Tables beyond 2x2 exist only on the structured path (the original path
// accepts at most three boundaries per axis), so they select it as well. So
// does cell text in a row taller than two lines: the original text proof
// expects one physical line per cell, the structured proof reads every line.
const tallRows=op=>Array.isArray(op.rows)&&op.rows.some((n,i)=>i&&n-op.rows[i-1]>2);
export const hasStructuredOperations=ops=>ops.some(op=>Object.hasOwn(STRUCTURED_FIELDS,op.type)||op.type==='table'&&(op.rows?.length>3||op.columns?.length>3||tallRows(op)&&ops.some(o=>o.type==='tableText')));
export function supportsTableProof(ops,proof){
 if(proof?.cellGetterMode!=='normal-editing')return false;
 if(hasStructuredOperations(ops))return proof.version===4&&proof.textVerified===true;
 return [2,3].includes(proof.version)&&(!ops.some(op=>op.type==='tableText')||(proof.version===3&&proof.textVerified===true));
}
const ensure=(ok,m)=>{if(!ok)throw new Error('Structured table: '+m);};
const fields=(v,keys)=>{ensure(v&&Object.getPrototypeOf(v)===Object.prototype&&!Array.isArray(v),'object required');for(const k of Reflect.ownKeys(v))ensure(typeof k==='string'&&keys.includes(k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'),'unknown or non-data field');};
const rgb=v=>typeof v==='string'&&/^R(0|[1-9]\d{0,2})G(0|[1-9]\d{0,2})B(0|[1-9]\d{0,2})$/.test(v)&&v.match(/\d+/g).every(n=>+n<=255);
const attrs={alignment:'文字揃え',textColor:'文字色',bold:'太字',italic:'斜体',fill:'塗りつぶし',color:'飾り色'};
const sides=['全角上','全角下','半角上','半角下','通常左','通常右','行間左','行間右'];
const rect=(s,c)=>({top:s.rows[c.top],bottom:s.rows[c.bottom],left:s.columns[c.left],right:s.columns[c.right]});
const sortedCells=s=>[...s.cells].sort((a,b)=>s.rows[a.top]-s.rows[b.top]||s.columns[a.left]-s.columns[b.left]);
const point=p=>{fields(p,['row','column']);ensure(Number.isInteger(p.row)&&Number.isInteger(p.column)&&p.row>=1&&p.column>=1,'one-based cell address required');};
const segmentKey=s=>s.join(',');
const edges=s=>s?new Map(tableGeometrySegments(s).map(e=>[segmentKey(e),e])):new Map();
function probe(s,c){const box=rect(s,c),crossing=s.cells.filter(v=>s.rows[v.top]<box.top+1&&s.rows[v.bottom]>box.top+1).sort((a,b)=>a.left-b.left);return {...box,cellColumn:crossing.findIndex(v=>v.id===c.id)+1};}

// Stages carry physical text anchors as well as cell lineage. The native
// operations preserve positions; inserted bands translate anchors, deletion
// deliberately removes only anchors in the selected band.
export function structuredPlan(operations,canvas){
 ensure(Array.isArray(operations)&&operations.length>0&&operations.length<=16,'1..16 operations required');
 let state,style,anchors=[],styles={};const stages=[];
 for(const op of operations){
  const before=state&&structuredClone(state),beforeAnchors=structuredClone(anchors);let lineage={},removed=[],target,band;
  if(op.type==='table'){
   fields(op,['type','rows','columns','lineType','color']);ensure(!state,'one table required');state=createTableGeometry(op.rows,op.columns);style={lineType:op.lineType,color:op.color};ensure(Number.isInteger(style.lineType)&&style.lineType>=1&&style.lineType<=15&&rgb(style.color),'invalid table style');
  }else{
   ensure(state,'table must be created first');
   if(op.type==='tableBand'){
    fields(op,STRUCTURED_FIELDS.tableBand);const row=op.axis==='row',key=row?'rows':'columns',values=state[key],k=op.index-1;
    ensure(['row','column'].includes(op.axis)&&['insert','delete'].includes(op.mode),'band axis/mode required');
    ensure(Number.isInteger(op.index)&&op.index>=1&&op.index<=values.length-(op.mode==='delete'?1:0),'invalid band index');
    const position=values[k],size=op.mode==='insert'?(op.size??values[Math.min(k+1,values.length-1)]-values[Math.min(k,values.length-2)]):values[k+1]-values[k];
    ensure(op.mode==='insert'||op.size===undefined,'delete does not accept size');
    // Copy insertion before a native band copies exactly its geometry. Other
    // sizes and append use normal insertion plus explicit boundary drawing.
    band={axis:op.axis,mode:op.mode,index:op.index,position,size,append:k===values.length-1};
    const changed=changeTableBand(state,{...op,size});state=changed.state;lineage=changed.lineage;removed=changed.removed;
    anchors=anchors.filter(a=>op.mode!=='delete'||a[row?'y':'x']<position||a[row?'y':'x']>=position+size).map(a=>({...a,[row?'y':'x']:a[row?'y':'x']+(a[row?'y':'x']>=position?(op.mode==='insert'?size:-size):0)}));
   }else if(op.type==='cellMerge'){
    fields(op,STRUCTURED_FIELDS.cellMerge);point(op.from);point(op.to);ensure(op.to.row>=op.from.row&&op.to.column>=op.from.column,'ordered merge rectangle required');
    const changed=mergeTableCells(state,{top:op.from.row-1,bottom:op.to.row,left:op.from.column-1,right:op.to.column});state=changed.state;lineage=changed.lineage;
   }else if(op.type==='cellSplit'){
    fields(op,STRUCTURED_FIELDS.cellSplit);point(op.cell);
    const changed=splitTableCell(state,{...op.cell,rows:op.rows,columns:op.columns});state=changed.state;lineage=changed.lineage;
   }else if(op.type==='tableText'){
    fields(op,['type','cell','text']);point(op.cell);target=cellAt(state,op.cell.row,op.cell.column).id;const box=rect(state,state.cells.find(c=>c.id===target));
    ensure(typeof op.text==='string'&&op.text.length<=Math.min(4,(box.right-box.left)/2-1)&&!/[\s\p{M}\p{C}\uD800-\uDFFF]/u.test(op.text),'short non-whitespace BMP text required');
    anchors=anchors.filter(a=>!(a.x>box.left&&a.x<box.right&&a.y>box.top&&a.y<box.bottom));if(op.text)anchors.push({y:box.top+1,x:box.left+2,text:op.text});
   }else if(op.type==='tableAttribute'){
    fields(op,['type','cell','attribute','value']);ensure(Object.hasOwn(attrs,op.attribute),'unknown cell attribute');
    if(op.cell){point(op.cell);target=cellAt(state,op.cell.row,op.cell.column).id;}
    const v=op.value;ensure(['color','textColor'].includes(op.attribute)?rgb(v):Number.isInteger(v)&&(op.attribute==='alignment'?[1,2,3,10].includes(v):op.attribute==='fill'?v>=0&&v<=107:[0,1].includes(v)),'invalid cell attribute');
   }else if(op.type==='tableRule'){
    fields(op,['type','axis','boundary','lineType','color']);ensure(['row','column'].includes(op.axis),'rule axis required');
    const values=state[op.axis==='row'?'rows':'columns'];ensure(Number.isInteger(op.boundary)&&op.boundary>=0&&op.boundary<values.length&&Number.isInteger(op.lineType)&&op.lineType>=1&&op.lineType<=15&&rgb(op.color),'invalid boundary style');
   }else throw new Error('Structured table: unsupported operation '+op.type);
  }
  ensure(state.rows[0]>1&&state.columns[0]>1&&state.rows.at(-1)<canvas.rows&&state.columns.at(-1)<canvas.columns,'table must leave a canvas guard margin');
  ensure(state.cells.length<=25,'at most 25 cells');
  // Splits through existing characters would overwrite text with a rule.
  ensure(anchors.every(a=>state.cells.some(c=>{const b=rect(state,c);return a.y>b.top&&a.y<b.bottom&&a.x>b.left&&a.x+2*a.text.length-2<b.right;})),'new border crosses existing text');
  if(band){
   const shifted={};for(const [key,value] of Object.entries(styles)){
    const e=key.split(',').map(Number),d=band.axis==='row'?0:1,start=e[d],finish=e[d+2];
    if(band.mode==='delete'&&start>=band.position&&start<band.position+band.size&&finish<=band.position+band.size)continue;
    for(const n of [d,d+2])if(e[n]>=(band.mode==='insert'?band.position:band.position+band.size))e[n]+=band.mode==='insert'?band.size:-band.size;
    if(e[0]===e[2])for(let x=e[1];x<e[3];x++)shifted[segmentKey([e[0],x,e[0],x+1])]=value;
    else for(let y=e[0];y<e[2];y++)shifted[segmentKey([y,e[1],y+1,e[1]])]=value;
   }styles=shifted;
  }
  styles=Object.fromEntries([...edges(state)].map(([key,e])=>{
   let value=styles[key]??style;
   if(op.type==='tableRule'){
    const row=op.axis==='row',position=state[row?'rows':'columns'][op.boundary];
    if(row?e[0]===position&&e[2]===position:e[1]===position&&e[3]===position)value={lineType:op.lineType,color:op.color};
   }return [key,{...value}];
  }));
  stages.push({op:structuredClone(op),before,state:structuredClone(state),beforeAnchors,anchors:structuredClone(anchors),style:{...style},styles:structuredClone(styles),lineage,removed,target,band});
 }
 return stages;
}

export function structuredMacro({canvas,operations,q}){
 const stages=structuredPlan(operations,canvas),apply=[];let current;
 const log=(key,value)=>`%result.LinePrint(${q(key+'=')} & ${value})`;
 const navigate=(s,c)=>{const p=probe(s,c);return ['CancelMode()','CancelAllRange()',`Jump(1,${p.top+1},1)`,`RightCell(${p.cellColumn})`];};
 const select=(s,c)=>[...navigate(s,c),'RangeMode(7)','RangeStart()','RangeEnd(1,1)'];
 const draw=(e,mode,style)=>['CancelMode()','CancelAllRange()','KeisenMode(2,1,1)',`Jump(1,${e[0]},${e[1]})`,'KeisenStart()',`Jump(1,${e[2]},${e[3]})`,'KeisenEnd()',`Keisen(${mode},${style.lineType},${q(style.color)})`,'CancelMode()'];
 function snapshot(stage,s=current){
  const a=['CancelMode()','CancelAllRange()','KeisenMode(2,1,1)'];
  for(const [n,side] of sides.entries())a.push(`%ks${n}=${q(side)}`);
  for(const [n,f] of ['線種','線色','背景色'].entries())a.push(`%kf${n}=${q(f)}`);
  for(const [n,side] of ['全角上','全角下','半角上','半角下'].entries())a.push(`%kc${n}=${q(side+'面取り')}`);
  // Sprint for/next is documented in T36SPR/html/t26s3837.htm. Keep the
  // bounded observations at runtime rather than emitting thousands of copies.
  a.push(`for %ky=1 to ${canvas.rows}`,`for %kx=1 to ${canvas.columns}`);
  {
   a.push(`%kp=${q(`keisen.${stage}.grid.`)} & %ky & "." & %kx & "."`,'Jump(1,%ky,%kx)','%k=GetPieceOfKeisen()');
   for(let sn=0;sn<sides.length;sn++)for(let fn=0;fn<3;fn++)a.push(`%result.LinePrint(%kp & %ks${sn} & "." & %kf${fn} & "=" & %k(%ks${sn},%kf${fn}))`);
   for(let sn=0;sn<4;sn++)a.push(`%result.LinePrint(%kp & %kc${sn} & "=" & %k(%kc${sn}))`);
  }
  a.push('next','next');
  if(s){a.push(log(`keisen.${stage}.cellGetterMode`,q('normal-editing')));for(const c of sortedCells(s)){
   a.push(...navigate(s,c),`%saved_${c.id.replace('-','_')}=GetKeisenAttribute()`);for(const f of Object.values(attrs))a.push(log(`keisen.${stage}.table.${c.id}.${f}`,`%saved_${c.id.replace('-','_')}(${q(f)})`));
   a.push(...select(s,c),'%text=GetString(2)','%n=0','foreach %v in %text','%n=%n+1',`%result.LinePrint(${q(`keisen.${stage}.text.${c.id}.line.`)} & %n & "=" & %v)`,'next',log(`keisen.${stage}.text.${c.id}.count`,'%n'));
  }}a.push('CancelMode()','CancelAllRange()');return a;
 }
 apply.push(...snapshot('initial'));
 for(const [i,step] of stages.entries()){
  const {op,before,state,style,band}=step;apply.push(`%phase="keisen-step-${i+1}"`);
  if(op.type==='table')for(const e of edges(state).values())apply.push(...draw(e,1,style));
  else if(band){
   const row=band.axis==='row',name=row?'Line':'Column',y=row?band.position:before.rows[0]+1,x=row?before.columns[0]:band.position;
   const axis=before[row?'rows':'columns'],start=row?'top':'left',end=row?'bottom':'right',k=band.index-1;
   const copy=band.mode==='insert'&&!band.append&&band.size===axis[k+1]-axis[k]&&!before.cells.some(c=>c[start]<k&&c[end]>k);
   apply.push('CancelMode()','CancelAllRange()',`KeisenModify${name}Mode(${band.mode==='insert'?1:2},${row?1:2})`,`Jump(1,${y},${x})`,`KeisenModify${name}Start()`,`Jump(1,${row?y+band.size-1:y},${row?x:x+band.size-1})`,`KeisenModify${name}End()`,`KeisenModify${name}(${copy?2:1}${row?'':',1'})`,'CancelMode()');
   // Native deletion of the first band can leave a one-sided outward stub
   // on the new outer boundary. Clear the guard-side segments explicitly;
   // all eight directions are still verified rather than ignoring that bit.
   for(const col of state.columns){apply.push(...draw([state.rows[0]-1,col,state.rows[0],col],0,style),...draw([state.rows.at(-1),col,state.rows.at(-1)+1,col],0,style));}
   for(const row of state.rows){apply.push(...draw([row,state.columns[0]-1,row,state.columns[0]],0,style),...draw([row,state.columns.at(-1),row,state.columns.at(-1)+1],0,style));}
   for(const [key,e] of edges(state))apply.push(...draw(e,1,step.styles[key]));
  }else if(['cellMerge','cellSplit'].includes(op.type)){
   const old=edges(before),next=edges(state);for(const [key,e] of old)if(!next.has(key))apply.push(...draw(e,0,style));for(const [key,e] of next)if(!old.has(key))apply.push(...draw(e,1,step.styles[key]));
  }else if(op.type==='tableRule'){
   const row=op.axis==='row',position=state[row?'rows':'columns'][op.boundary];
   for(const [key,e] of edges(state))if(row?e[0]===position&&e[2]===position:e[1]===position&&e[3]===position)apply.push(...draw(e,1,step.styles[key]));
  }else if(op.type==='tableText'){
   const c=state.cells.find(c=>c.id===step.target);apply.push(...select(state,c),'EraseKeisenCell()',...navigate(state,c),...(op.text?[`Insert(${q(op.text)})`]:[]));
  }else if(op.type==='tableAttribute'){
   for(const c of sortedCells(state).filter(c=>!step.target||c.id===step.target)){
    const args=Object.keys(attrs).map(k=>k===op.attribute?(typeof op.value==='string'?q(op.value):op.value):'');while(args.at(-1)==='')args.pop();apply.push(...select(state,c),`SetKeisenAttribute(${args.join(',')})`);
   }
  }
  current=state;apply.push(...snapshot(`step-${i+1}`));
 }
 return {apply,snapshot,bodyMethod:2};
}

export function verifyStructuredReadback(meta,{canvas,operations}){
 const plan=structuredPlan(operations,canvas),snapshots={},differences=[],checks=[];
 const fail=(stage,field,expected,actual)=>differences.push({phase:stage,field,expected,actual});
 const all=[['initial',undefined],...plan.map((s,i)=>[`step-${i+1}`,s]),['before-save',plan.at(-1)],['reopened',plan.at(-1)]];
 for(const [stage,step] of all){
  const state=step?.state,grid={},cells={},textLines={};
  for(let y=1;y<=canvas.rows;y++)for(let x=1;x<=canvas.columns;x++){
   for(const side of sides)for(const f of ['線種','線色','背景色']){const key=`${y}.${x}.${side}.${f}`,v=meta[`keisen.${stage}.grid.${key}`];ensure(f==='線色'?rgb(v):/^\d+$/.test(v??''),'missing grid getter '+key);grid[key]=v;}
   for(const side of ['全角上','全角下','半角上','半角下']){const key=`${y}.${x}.${side}面取り`,v=meta[`keisen.${stage}.grid.${key}`];ensure(/^[01]$/.test(v??''),'missing chamfer');grid[key]=v;}
  }
  const expectedEdges=new Map();for(const [key,[y,x,yy]] of edges(state)){
   const style=step.styles[key];if(y===yy){expectedEdges.set(`${y}.${x}.通常右`,style);expectedEdges.set(`${y}.${x+1}.通常左`,style);}else{expectedEdges.set(`${y}.${x}.半角下`,style);expectedEdges.set(`${y+1}.${x}.半角上`,style);}
  }
  for(const [key,v] of Object.entries(grid)){
   if(key.endsWith('線色')){const style=expectedEdges.get(key.slice(0,-3));if(style&&v!==style.color)fail(stage,key,style.color,v);}
   else{const want=key.endsWith('線種')&&expectedEdges.has(key.slice(0,-3))?String(expectedEdges.get(key.slice(0,-3)).lineType):'0';if(v!==want)fail(stage,key,want,v);}
  }
  if(state){ensure(meta[`keisen.${stage}.cellGetterMode`]==='normal-editing','normal-editing marker required');for(const c of sortedCells(state)){
   cells[c.id]={};for(const f of Object.values(attrs)){const v=meta[`keisen.${stage}.table.${c.id}.${f}`];ensure(typeof v==='string'&&(f.endsWith('色')?rgb(v):/^\d+$/.test(v)),'missing cell getter');cells[c.id][f]=v;}
   const prefix=`keisen.${stage}.text.${c.id}.`,count=Number(meta[prefix+'count']),b=rect(state,c);ensure(Number.isInteger(count)&&count>=1&&count<=canvas.rows,'invalid text count');
   const lines=[];for(let n=1;n<=count;n++){ensure(typeof meta[prefix+'line.'+n]==='string','missing text line');lines.push(meta[prefix+'line.'+n]);}textLines[c.id]=lines;
   const wanted=Array.from({length:b.bottom-b.top-1},(_,n)=>step.anchors.filter(a=>a.y===b.top+1+n&&a.x>b.left&&a.x<b.right).sort((a,z)=>a.x-z.x).map(a=>a.text).join(''));
   if(JSON.stringify(lines.map(v=>v.replace(/\s/gu,'')))!==JSON.stringify(wanted))fail(stage,`text.${c.id}`,wanted,lines);
  }}
  snapshots[stage]={grid,cells,textLines,...(state?{geometry:state,bodyNonWhitespace:step.anchors.slice().sort((a,b)=>a.y-b.y||a.x-b.x).map(a=>a.text).join('')}:{bodyNonWhitespace:''})};
 }
 let previous=snapshots.initial;
 for(const [i,step] of plan.entries()){
  const stage=`step-${i+1}`,current=snapshots[stage];
  if(step.op.type!=='table')for(const c of step.state.cells){
   const parents=step.lineage[c.id]??(previous.cells[c.id]?[c.id]:[]);
   for(const parent of parents)for(const [f,value] of Object.entries(previous.cells[parent]??{})){
    const targeted=!step.target||c.id===step.target;const want=step.op.type==='tableAttribute'&&targeted&&attrs[step.op.attribute]===f?String(step.op.value):value;
    if(current.cells[c.id][f]!==want)fail(stage,`cell.${c.id}.${f}`,want,current.cells[c.id][f]);
   }
  }
  checks.push({stage,type:step.op.type,operation:step.op,lineage:step.lineage,removed:step.removed,tableBefore:step.before,tableAfter:step.state,strength:'full-grid-and-cell-attributes-and-physical-text-lines',passed:!differences.some(d=>d.phase===stage)});previous=current;
 }
 for(const [a,b] of [[previous,snapshots['before-save']],[snapshots['before-save'],snapshots.reopened]])if(JSON.stringify(a)!==JSON.stringify(b))fail(b===snapshots.reopened?'reopened':'before-save','state','unchanged','changed');
 return {snapshots,differences,proof:{version:4,textVerified:true,cellGetterMode:'normal-editing',passed:!differences.length,reopened:!differences.some(d=>d.phase==='reopened'),checks,coverage:'all bounded grid directions, every irregular cell and physical text line',limitations:['Structural whitespace in cell text ignored for requested comparison; raw lines must match on reopen.','Cell attributes checked at one normal-mode probe per cell; mixed character attributes are not measured.','Outside the grid is not observed; geometry in millimeters is not measured.']}};
}
