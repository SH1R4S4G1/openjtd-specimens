// Pure geometry for irregular ruled tables. Indices refer to boundary arrays,
// not character positions. Runtime macro support is integrated separately.
const check=(ok,message)=>{if(!ok)throw new Error('Table geometry: '+message);};
const clone=state=>structuredClone(state);
const overlaps=(a,b)=>a.top<b.bottom&&b.top<a.bottom&&a.left<b.right&&b.left<a.right;
export function validateTableGeometry(state){
 for(const [name,gap] of [['rows',1],['columns',2]])check(Array.isArray(state[name])&&state[name].length>=2&&state[name].every((v,i)=>Number.isInteger(v)&&v>0&&(!i||v-state[name][i-1]>=gap)),'ordered axes required');
 check(state.columns.every(v=>v%2===1),'columns must align with full-width boundaries');
 const ids=new Set();
 for(const c of state.cells){
  check(typeof c.id==='string'&&!ids.has(c.id),'unique cell IDs required');ids.add(c.id);
  check(['top','bottom','left','right'].every(k=>Number.isInteger(c[k]))&&c.top>=0&&c.left>=0&&c.bottom>c.top&&c.right>c.left&&c.bottom<state.rows.length&&c.right<state.columns.length,'invalid cell rectangle');
  check(state.rows[c.bottom]-state.rows[c.top]>=2&&state.columns[c.right]-state.columns[c.left]>=4,'cell interior too small');
 }
 for(let row=0;row<state.rows.length-1;row++)for(let col=0;col<state.columns.length-1;col++)check(state.cells.filter(c=>c.top<=row&&c.bottom>row&&c.left<=col&&c.right>col).length===1,'cells must tile the table without overlaps or gaps');
 check(Number.isInteger(state.nextId)&&state.nextId>=0,'nextId required');return state;
}
export function createTableGeometry(rows,columns){
 const state={rows:[...rows],columns:[...columns],cells:[],nextId:0};
 for(let r=0;r<rows.length-1;r++)for(let c=0;c<columns.length-1;c++)state.cells.push({id:`cell-${state.nextId++}`,top:r,bottom:r+1,left:c,right:c+1});
 return validateTableGeometry(state);
}
export function cellAt(state,row,column){
 check(Number.isInteger(row)&&Number.isInteger(column)&&row>=1&&column>=1,'cell address is one-based');
 const cell=state.cells.find(c=>c.top<row&&c.bottom>=row&&c.left<column&&c.right>=column);check(cell,'cell outside table');return cell;
}
export function mergeTableCells(input,{top,bottom,left,right}){
 validateTableGeometry(input);const state=clone(input),rect={top,bottom,left,right};
 check(Object.values(rect).every(Number.isInteger)&&top>=0&&left>=0&&bottom>top&&right>left&&bottom<state.rows.length&&right<state.columns.length,'invalid merge rectangle');
 const parents=state.cells.filter(c=>overlaps(c,rect));
 check(parents.length>=2&&parents.every(c=>c.top>=top&&c.bottom<=bottom&&c.left>=left&&c.right<=right),'merge must contain complete cells and form a rectangle');
 const id=`cell-${state.nextId++}`;state.cells=state.cells.filter(c=>!parents.includes(c));state.cells.push({id,...rect});
 return {state:validateTableGeometry(state),lineage:{[id]:parents.map(c=>c.id)}};
}
export function splitTableCell(input,{row,column,rows=1,columns=1}){
 validateTableGeometry(input);const state=clone(input),target=cellAt(state,row,column);
 check(Number.isInteger(rows)&&Number.isInteger(columns)&&rows>=1&&columns>=1&&rows*columns>1&&rows<=8&&columns<=8,'split counts required');
 const top=state.rows[target.top],bottom=state.rows[target.bottom],left=state.columns[target.left],right=state.columns[target.right];
 const ys=Array.from({length:rows+1},(_,i)=>top+(bottom-top)*i/rows),xs=Array.from({length:columns+1},(_,i)=>left+(right-left)*i/columns);
 check(ys.every(Number.isInteger)&&(bottom-top)/rows>=2&&xs.every(x=>Number.isInteger(x)&&x%2===1)&&(right-left)/columns>=4,'split must preserve integral positions and minimum interiors');
 const physical=state.cells.map(c=>({...c,top:state.rows[c.top],bottom:state.rows[c.bottom],left:state.columns[c.left],right:state.columns[c.right]}));
 state.rows=[...new Set([...state.rows,...ys])].sort((a,b)=>a-b);state.columns=[...new Set([...state.columns,...xs])].sort((a,b)=>a-b);
 state.cells=physical.filter(c=>c.id!==target.id).map(c=>({...c,top:state.rows.indexOf(c.top),bottom:state.rows.indexOf(c.bottom),left:state.columns.indexOf(c.left),right:state.columns.indexOf(c.right)}));
 const lineage={};for(let r=0;r<rows;r++)for(let c=0;c<columns;c++){
  const id=`cell-${state.nextId++}`;state.cells.push({id,top:state.rows.indexOf(ys[r]),bottom:state.rows.indexOf(ys[r+1]),left:state.columns.indexOf(xs[c]),right:state.columns.indexOf(xs[c+1])});lineage[id]=[target.id];
 }
 return {state:validateTableGeometry(state),lineage};
}
export function changeTableBand(input,{axis,mode,index,size}){
 validateTableGeometry(input);check(['row','column'].includes(axis)&&['insert','delete'].includes(mode),'axis and mode required');
 const state=clone(input),row=axis==='row',key=row?'rows':'columns',start=row?'top':'left',end=row?'bottom':'right',otherStart=row?'left':'top',otherEnd=row?'right':'bottom',values=state[key],k=index-1;
 check(Number.isInteger(index)&&index>=1&&index<values.length+(mode==='insert'?1:0),'band index outside table');
 const lineage={},removed=[];
 if(mode==='insert'){
  check(Number.isInteger(size)&&size>=(row?2:4)&&(row||size%2===0),'invalid inserted band size');
  const position=values[k];state[key]=[...values.slice(0,k),position,...values.slice(k).map(v=>v+size)];
  for(const c of state.cells){if(c[start]>=k){c[start]++;c[end]++;}else if(c[end]>k)c[end]++;lineage[c.id]=[c.id];}
  const other=state[row?'columns':'rows'];for(let i=0;i<other.length-1;i++){
   if(state.cells.some(c=>c[start]<=k&&c[end]>k&&c[otherStart]<=i&&c[otherEnd]>i))continue;
   const id=`cell-${state.nextId++}`;state.cells.push({id,[start]:k,[end]:k+1,[otherStart]:i,[otherEnd]:i+1});lineage[id]=[];
  }
 }else{
  check(values.length>2,'cannot delete the last band');
  const delta=values[k+1]-values[k];state[key]=[...values.slice(0,k),...values.slice(k+1).map(v=>v-delta)];
  state.cells=state.cells.filter(c=>{if(c[start]===k&&c[end]===k+1){removed.push(c.id);return false;}if(c[start]>=k+1)c[start]--;if(c[end]>=k+1)c[end]--;lineage[c.id]=[c.id];return true;});
 }
 return {state:validateTableGeometry(state),lineage,removed};
}
export function tableGeometrySegments(state){
 validateTableGeometry(state);const segments=new Map();
 for(const c of state.cells){
  for(const r of [c.top,c.bottom])for(let x=state.columns[c.left];x<state.columns[c.right];x++)segments.set(`h:${state.rows[r]}:${x}`,[state.rows[r],x,state.rows[r],x+1]);
  for(const col of [c.left,c.right])for(let y=state.rows[c.top];y<state.rows[c.bottom];y++)segments.set(`v:${y}:${state.columns[col]}`,[y,state.columns[col],y+1,state.columns[col]]);
 }return [...segments.values()];
}
