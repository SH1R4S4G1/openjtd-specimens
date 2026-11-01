import test from 'node:test';import assert from 'node:assert/strict';
import {hasStructuredOperations,structuredPlan,structuredMacro,supportsTableProof,verifyStructuredReadback} from '../src/keisen-structured.mjs';
import {tableGeometrySegments} from '../src/table-geometry.mjs';
const table={type:'table',rows:[2,4,6],columns:[3,7,11],lineType:1,color:'R0G0B0'},canvas={rows:9,columns:17};
const text=(row,column,text)=>({type:'tableText',cell:{row,column},text});
test('band plans shift existing text and deleting a band removes only its own text',()=>{
 const initial=[table,text(1,1,'甲'),text(2,2,'乙')];
 const plan=structuredPlan([...initial,{type:'tableBand',axis:'row',mode:'insert',index:2},{type:'tableBand',axis:'row',mode:'delete',index:1}],canvas);
 assert.deepEqual(plan[3].anchors,[{y:3,x:5,text:'甲'},{y:7,x:9,text:'乙'}]);
 assert.deepEqual(plan[4].anchors,[{y:5,x:9,text:'乙'}]);
 assert.equal(plan[3].state.cells.length,6);assert.equal(plan[4].state.cells.length,4);
 const columns=structuredPlan([...initial,{type:'tableBand',axis:'column',mode:'insert',index:2}],canvas);
 assert.deepEqual(columns.at(-1).anchors,[{y:3,x:5,text:'甲'},{y:5,x:13,text:'乙'}]);
});
test('local merge and split retain physical anchors and preserve unrelated cells',()=>{
 const ops=[table,text(1,1,'甲'),text(2,1,'丙'),{type:'cellMerge',from:{row:1,column:1},to:{row:2,column:1}},
  {type:'cellSplit',cell:{row:1,column:1},rows:2,columns:1}];
 const plan=structuredPlan(ops,canvas);assert.equal(plan[3].state.cells.length,3);assert.equal(plan[4].state.cells.length,4);
 assert.deepEqual(plan[2].anchors,plan[4].anchors);assert.deepEqual(Object.values(plan[3].lineage),[['cell-0','cell-2']]);
 assert.throws(()=>structuredPlan([...ops,{type:'tableBand',axis:'row',mode:'insert',index:99}],canvas));
 assert.throws(()=>structuredPlan([table,{type:'cellMerge',from:{row:2,column:1},to:{row:1,column:1}}],canvas));
});
test('snapshot leaves ruled-line mode before attempting range cancellation',()=>{
 const ops=[table,{type:'tableBand',axis:'row',mode:'insert',index:2}],macro=structuredMacro({canvas,operations:ops,q:JSON.stringify});
 const initial=macro.apply.slice(0,macro.apply.indexOf('%phase="keisen-step-1"'));
 assert.deepEqual(initial.slice(-2),['CancelMode()','CancelAllRange()']);
 assert.deepEqual(macro.snapshot('reopened').slice(-2),['CancelMode()','CancelAllRange()']);
 assert.match(macro.apply.join('\n'),/KeisenModifyLineMode\(1,1\)/);
 assert.match(macro.snapshot('reopened').join('\n'),/GetString\(2\)/);
 assert.equal(macro.bodyMethod,2,'GetString(1) can omit neighboring text beside a spanning cell');
 assert.match(initial.join('\n'),/for %ky=1 to 9\nfor %kx=1 to 17/);
 assert.match(initial.join('\n'),/Jump\(1,%ky,%kx\)/);
 assert.ok(initial.length<100,'grid observations must not expand into thousands of source lines');
});
test('boundary styles move with bands and new boundaries use the table creation style',()=>{
 const rule={type:'tableRule',axis:'row',boundary:0,lineType:3,color:'R255G0B0'};
 const p=structuredPlan([table,rule,{type:'tableBand',axis:'row',mode:'insert',index:1},{type:'tableBand',axis:'row',mode:'delete',index:1}],canvas);
 assert.deepEqual(p[1].styles['2,3,2,4'],{lineType:3,color:'R255G0B0'});
 assert.deepEqual(p[2].styles['4,3,4,4'],{lineType:3,color:'R255G0B0'});
 assert.deepEqual(p[2].styles['2,3,2,4'],{lineType:1,color:'R0G0B0'});
 assert.deepEqual(p[3].styles['2,3,2,4'],{lineType:3,color:'R255G0B0'});
});
test('deletion compiler explicitly removes outward boundary stubs within the guard margin',()=>{
 const ops=[table,{type:'tableBand',axis:'row',mode:'delete',index:1}],m=structuredMacro({canvas,operations:ops,q:JSON.stringify}).apply.join('\n');
 assert.match(m,/Jump\(1,1,3\)\nKeisenStart\(\)\nJump\(1,2,3\)\nKeisenEnd\(\)\nKeisen\(0,1,"R0G0B0"\)/);
 assert.match(m,/Jump\(1,4,11\)\nKeisenStart\(\)\nJump\(1,5,11\)\nKeisenEnd\(\)\nKeisen\(0,1,"R0G0B0"\)/);
});
test('structured operations cannot use a legacy text or blank-table proof',()=>{
 const ops=[table,{type:'cellMerge',from:{row:1,column:1},to:{row:2,column:1}}];
 for(const version of [2,3])assert.equal(supportsTableProof(ops,{version,textVerified:true,cellGetterMode:'normal-editing'}),false);
 assert.equal(supportsTableProof(ops,{version:4,textVerified:true,cellGetterMode:'normal-editing'}),true);
 assert.equal(supportsTableProof(ops,{version:4,textVerified:false,cellGetterMode:'normal-editing'}),false);
});
test('structured verification detects lost text, stale borders, missing evidence and leaked attributes',()=>{
 const canvas={rows:7,columns:13},ops=[table,text(1,1,'甲'),text(2,1,'乙'),{type:'cellMerge',from:{row:1,column:1},to:{row:2,column:1}}],plan=structuredPlan(ops,canvas),meta={};
 const stages=[['initial',undefined],...plan.map((s,i)=>[`step-${i+1}`,s]),['before-save',plan.at(-1)],['reopened',plan.at(-1)]];
 for(const [stage,step] of stages){
  const directions=new Set();for(const [y,x,yy] of step?tableGeometrySegments(step.state):[]){
   if(y===yy){directions.add(`${y}.${x}.通常右`);directions.add(`${y}.${x+1}.通常左`);}else{directions.add(`${y}.${x}.半角下`);directions.add(`${y+1}.${x}.半角上`);}
  }
  for(let y=1;y<=canvas.rows;y++)for(let x=1;x<=canvas.columns;x++)for(const side of ['全角上','全角下','半角上','半角下','通常左','通常右','行間左','行間右']){
   const p=`keisen.${stage}.grid.${y}.${x}.${side}`;
   meta[p+'.線種']=directions.has(`${y}.${x}.${side}`)?'1':'0';meta[p+'.線色']='R0G0B0';meta[p+'.背景色']='0';
   if(['全角上','全角下','半角上','半角下'].includes(side))meta[p+'面取り']='0';
  }
  if(step){meta[`keisen.${stage}.cellGetterMode`]='normal-editing';for(const c of step.state.cells){
   for(const [k,v] of Object.entries({'文字揃え':'1','文字色':'R0G0B0','太字':'0','斜体':'0','塗りつぶし':'0','飾り色':'R0G0B0'}))meta[`keisen.${stage}.table.${c.id}.${k}`]=v;
   const count=step.state.rows[c.bottom]-step.state.rows[c.top]-1,p=`keisen.${stage}.text.${c.id}.`;meta[p+'count']=String(count);
   for(let n=1;n<=count;n++)meta[p+'line.'+n]=step.anchors.filter(a=>a.y===step.state.rows[c.top]+n&&a.x>step.state.columns[c.left]&&a.x<step.state.columns[c.right]).map(a=>a.text).join('');
  }}
 }
 const proof=verifyStructuredReadback(meta,{canvas,operations:ops}).proof;assert.equal(proof.passed,true);assert.equal(proof.version,4);
 const mergedId=Object.keys(plan.at(-1).lineage)[0];
 for(const [key,value] of [[`keisen.step-4.text.${mergedId}.line.3`, ''],['keisen.step-4.grid.4.3.通常右.線種','1'],
  ['keisen.step-4.table.cell-1.塗りつぶし','50'],[`keisen.reopened.text.${mergedId}.line.1`,'丙'],['keisen.step-4.grid.2.3.通常右.線色','R255G0B0']])
  assert.equal(verifyStructuredReadback({...meta,[key]:value},{canvas,operations:ops}).proof.passed,false,key);
 const missing={...meta};delete missing[`keisen.reopened.text.${mergedId}.line.2`];assert.throws(()=>verifyStructuredReadback(missing,{canvas,operations:ops}),/missing text line/);
});
test('tables beyond 2x2 and text in tall rows select the structured path',()=>{
 const make=(rows,columns)=>({type:'table',rows,columns,lineType:1,color:'R0G0B0'}),cellText={type:'tableText',cell:{row:1,column:1},text:'甲'};
 assert.equal(hasStructuredOperations([make([2,4,6],[3,7,11])]),false);
 assert.equal(hasStructuredOperations([make([2,4,6,8],[3,7,11])]),true);
 assert.equal(hasStructuredOperations([make([2,4,6],[3,7,11,15])]),true);
 assert.equal(hasStructuredOperations([make([2,5,7],[3,7,11])]),false);
 assert.equal(hasStructuredOperations([make([2,5,7],[3,7,11]),cellText]),true);
 assert.equal(hasStructuredOperations([make([2,4,6],[3,9,19]),cellText]),false);
});
