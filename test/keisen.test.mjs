import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {KEISEN_SIDES,validateKeisenCanvas,validateKeisenOperations,verifyKeisenReadback,resizeKeisenTable,changeKeisenTopology,tableRuleLine} from '../src/keisen.mjs';
import {expandExperiment} from '../src/experiment.mjs';import {compileSample} from '../src/adapters/macro.mjs';
const recipe=JSON.parse(fs.readFileSync(new URL('../examples/body-keisen.json',import.meta.url)));
function blank(canvas){const grid={};for(let r=1;r<=canvas.rows;r++)for(let c=1;c<=canvas.columns;c++){
 for(const s of KEISEN_SIDES)for(const f of ['線種','線色','背景色'])grid[`${r}.${c}.${s}.${f}`]=f==='線色'?'R0G0B0':'0';
 for(const s of ['全角上','全角下','半角上','半角下'])grid[`${r}.${c}.${s}面取り`]='0';
}return {grid,cells:{}};}
function emit(states){const meta={};for(const [stage,state] of Object.entries(states)){if(Object.keys(state.cells).length)meta[`keisen.${stage}.cellGetterMode`]='normal-editing';for(const [k,v] of Object.entries(state.grid))meta[`keisen.${stage}.grid.${k}`]=v;for(const [id,attrs] of Object.entries(state.cells))for(const [k,v] of Object.entries(attrs))meta[`keisen.${stage}.table.${id}.${k}`]=v;}return meta;}
const copy=x=>structuredClone(x);
test('cell text rejects wrapping risks, controls, whitespace and later structural changes',()=>{
 const canvas={rows:7,columns:13},table={type:'table',rows:[2,4,6],columns:[3,7,11],lineType:1,color:'R0G0B0'},op={type:'tableText',cell:{row:1,column:1},text:'甲'};
 for(const text of ['甲乙',' ','\n','\t','😀','a\u0301','\u200b'])assert.throws(()=>validateKeisenOperations([table,{...op,text}],canvas));
 for(const text of ['甲','A',''])assert.equal(validateKeisenOperations([table,{...op,text}],canvas)[1].text,text);
 assert.throws(()=>validateKeisenOperations([op],canvas));
 assert.throws(()=>validateKeisenOperations([table,{...op,cell:{row:3,column:1}}],canvas));
 assert.throws(()=>validateKeisenOperations([table,op,{type:'tableMerge',axis:'row',boundary:1}],canvas),/precede/);
});
test('cell text proof requires exact text for all cells, replacement, clearing and reopening',()=>{
 const canvas={rows:5,columns:13},table={type:'table',rows:[2,4],columns:[3,7,11],lineType:1,color:'R0G0B0'},empty=blank(canvas);
 for(const y of [2,4])for(let x=3;x<11;x++)for(const pre of [`${y}.${x}.通常右`,`${y}.${x+1}.通常左`])empty.grid[pre+'.線種']='1';
 for(const x of [3,7,11])for(let y=2;y<4;y++)for(const pre of [`${y}.${x}.半角下`,`${y+1}.${x}.半角上`])empty.grid[pre+'.線種']='1';
 for(const id of ['0-0','0-1'])empty.cells[id]={'文字揃え':'1','文字色':'R0G0B0','太字':'0','斜体':'0','塗りつぶし':'0','飾り色':'R0G0B0'};
 const op={type:'tableText',cell:{row:1,column:1},text:'甲'},operations=[table,op,{...op,text:'乙'},{...op,text:''}];
 const states={initial:blank(canvas),'step-1':empty,'step-2':empty,'step-3':empty,'step-4':empty,'before-save':empty,reopened:empty};
 const meta=emit(states);
 for(const stage of Object.keys(states).filter(s=>s!=='initial'))for(const id of ['0-0','0-1']){
  meta[`keisen.${stage}.text.${id}.count`]='1';meta[`keisen.${stage}.text.${id}.line.1`]=id==='0-0'?({'step-2':'甲','step-3':'乙'}[stage]??''):'';
 }
 for(const stage of ['step-2','step-3','step-4'])for(const [k,v] of Object.entries({'始点ページ':'1','始点行':'3','始点桁':'7','終点ページ':'1','終点行':'3','終点桁':'9','単位':'7'}))meta[`keisen.${stage}.selection.${k}`]=v;
 const verified=verifyKeisenReadback(meta,{canvas,operations});assert.equal(verified.proof.passed,true);assert.equal(verified.proof.version,3);assert.equal(verified.proof.textVerified,true);
 for(const [k,v] of [['keisen.step-2.text.0-1.line.1','甲'],['keisen.step-3.text.0-0.line.1','甲'],['keisen.reopened.text.0-0.line.1','乙'],['keisen.step-2.table.0-0.太字','1']])
  assert.equal(verifyKeisenReadback({...meta,[k]:v},{canvas,operations}).proof.passed,false);
 const missing={...meta};delete missing['keisen.reopened.text.0-1.line.1'];assert.throws(()=>verifyKeisenReadback(missing,{canvas,operations}),/missing cell text/);
 assert.throws(()=>verifyKeisenReadback({...meta,'keisen.reopened.text.0-1.count':'2'},{canvas,operations}),/exactly one/);
});
test('table rules resolve evolving boundary coordinates and reject unsafe operation orders',()=>{
 const canvas={rows:8,columns:15},table={type:'table',rows:[2,4,6],columns:[3,7,11],lineType:1,color:'R0G0B0'},
 rule={type:'tableRule',axis:'column',boundary:1,lineType:3,color:'R0G0B255'};
 assert.deepEqual(tableRuleLine(table,rule),{type:'line',mode:'change',from:{row:2,column:7},to:{row:6,column:7},lineType:3,color:'R0G0B255'});
 const resized=resizeKeisenTable(table,{type:'tableResize',axis:'column',index:1,delta:2},canvas);
 assert.equal(tableRuleLine(resized,rule).from.column,9);
 for(const bad of [{...rule,boundary:-1},{...rule,boundary:3},{...rule,boundary:0.5},{...rule,axis:'x'},
   {...rule,lineType:0},{...rule,color:'R256G0B0'},{...rule,mode:'clear'}])assert.throws(()=>validateKeisenOperations([table,bad],canvas));
 assert.throws(()=>validateKeisenOperations([rule],canvas));
 for(const op of [{type:'tableResize',axis:'row',index:1,delta:1},{type:'tableMerge',axis:'column',boundary:1}])
   assert.throws(()=>validateKeisenOperations([table,rule,op],canvas),/precede/);
 assert.equal(validateKeisenOperations([table,{type:'tableAttribute',attribute:'fill',value:50},rule,{...rule,boundary:0}],canvas).length,4);
});
test('table boundary style proof detects spill at crossings, changed cells and stale reopened styles',()=>{
 const canvas={rows:7,columns:13},initial=blank(canvas),drawn=copy(initial),table={type:'table',rows:[2,4,6],columns:[3,7,11],lineType:1,color:'R0G0B0'};
 for(const y of [2,4,6])for(let x=3;x<11;x++)for(const pre of [`${y}.${x}.通常右`,`${y}.${x+1}.通常左`])drawn.grid[pre+'.線種']='1';
 for(const x of [3,7,11])for(let y=2;y<6;y++)for(const pre of [`${y}.${x}.半角下`,`${y+1}.${x}.半角上`])drawn.grid[pre+'.線種']='1';
 for(const id of ['0-0','0-1','1-0','1-1'])drawn.cells[id]={'文字揃え':'1','文字色':'R0G0B0','太字':'0','斜体':'0','塗りつぶし':'0','飾り色':'R0G0B0'};
 const changed=copy(drawn);
 for(let x=3;x<11;x++)for(const pre of [`4.${x}.通常右`,`4.${x+1}.通常左`]){changed.grid[pre+'.線種']='3';changed.grid[pre+'.線色']='R0G0B255';}
 const rule={type:'tableRule',axis:'row',boundary:1,lineType:3,color:'R0G0B255'},operations=[table,rule];
 const meta=emit({initial,'step-1':drawn,'step-2':changed,'before-save':changed,reopened:changed});
 const proof=verifyKeisenReadback(meta,{canvas,operations}).proof;assert.equal(proof.passed,true);assert.equal(proof.checks[1].boundary,1);
 for(const [k,v] of [['keisen.step-2.grid.4.7.半角下.線色','R0G0B255'],['keisen.step-2.grid.2.5.通常右.線種','3'],
  ['keisen.step-2.table.1-1.塗りつぶし','50'],['keisen.reopened.grid.4.8.通常右.線種','1']])
   assert.equal(verifyKeisenReadback({...meta,[k]:v},{canvas,operations}).proof.passed,false,k);
 const restored=emit({initial,'step-1':drawn,'step-2':changed,'step-3':drawn,'before-save':drawn,reopened:drawn});
 assert.equal(verifyKeisenReadback(restored,{canvas,operations:[...operations,{...rule,lineType:1,color:'R0G0B0'}]}).proof.passed,true);
});
test('keisen recipes reject out-of-grid, diagonal, invalid colors and mixed target models',()=>{
 const p=expandExperiment(recipe);assert.deepEqual(p.keisenCanvas,recipe.keisenCanvas);assert.equal(p.samples[0].keisenOperations.length,0);
 const op=recipe.samples[1].keisenOperations[0];
 for(const bad of [{...op,to:{row:4,column:11}},{...op,from:{row:0,column:3}},{...op,lineType:16},{...op,color:'R256G0B0'},{...op,color:'R0G0B0\nKeisen(0)'},{type:'tableAttribute',attribute:'fill',value:50}])assert.throws(()=>validateKeisenOperations([bad],recipe.keisenCanvas));
 assert.throws(()=>validateKeisenCanvas(recipe.keisenCanvas,'ASCII'));
 const table={type:'table',rows:[2,4,6],columns:[3,7,11],lineType:1,color:'R0G0B0'};
 for(const cell of [{row:0,column:1},{row:3,column:1},{row:1,column:1.5},{row:1,column:1,extra:1}])assert.throws(()=>validateKeisenOperations([table,{type:'tableAttribute',attribute:'fill',value:50,cell}],recipe.keisenCanvas));
 assert.throws(()=>expandExperiment({...recipe,targets:[{id:'a',kind:'text',start:0,end:1,expected:'甲'}]}));
});
test('grid proof checks both ends, colors, outside edges, chamfers and reopen equality',()=>{
 const canvas={rows:3,columns:5},initial=blank(canvas),after=copy(initial),op={type:'line',mode:'draw',from:{row:2,column:2},to:{row:2,column:4},lineType:3,color:'R255G0B0'};
 for(const pre of ['2.2.通常右','2.3.通常左','2.3.通常右','2.4.通常左']){after.grid[pre+'.線種']='3';after.grid[pre+'.線色']='R255G0B0';}
 const meta=emit({initial,'step-1':after,'before-save':after,reopened:after});
 assert.equal(verifyKeisenReadback(meta,{canvas,operations:[op]}).proof.passed,true);
 for(const [k,v] of [['keisen.step-1.grid.2.4.通常左.線種','0'],['keisen.step-1.grid.2.3.通常右.線色','R0G0B0'],['keisen.step-1.grid.1.1.通常右.線種','1'],['keisen.step-1.grid.1.1.半角上面取り','1'],['keisen.reopened.grid.2.3.通常右.線種','1']])assert.equal(verifyKeisenReadback({...meta,[k]:v},{canvas,operations:[op]}).proof.passed,false);
 const missing={...meta};delete missing['keisen.reopened.grid.1.1.通常左.線種'];assert.throws(()=>verifyKeisenReadback(missing,{canvas,operations:[op]}));
});
test('table attribute proof requires all table probes to match and preserves other fields',()=>{
 const canvas={rows:7,columns:13},initial=blank(canvas),drawn=copy(initial),table={type:'table',rows:[2,4,6],columns:[3,7,11],lineType:1,color:'R0G0B0'};
 for(const r of [2,4,6])for(let c=3;c<11;c++){drawn.grid[`${r}.${c}.通常右.線種`]='1';drawn.grid[`${r}.${c+1}.通常左.線種`]='1';}
 for(const c of [3,7,11])for(let r=2;r<6;r++){drawn.grid[`${r}.${c}.半角下.線種`]='1';drawn.grid[`${r+1}.${c}.半角上.線種`]='1';}
 for(const id of ['0-0','0-1','1-0','1-1'])drawn.cells[id]={'文字揃え':'1','文字色':'R0G0B0','太字':'0','斜体':'0','塗りつぶし':'0','飾り色':'R0G0B0'};
 const changed=copy(drawn);for(const c of Object.values(changed.cells))c['塗りつぶし']='50';
 const operations=[table,{type:'tableAttribute',attribute:'fill',value:50}],meta=emit({initial,'step-1':drawn,'step-2':changed,'before-save':changed,reopened:changed});
 assert.equal(verifyKeisenReadback(meta,{canvas,operations}).proof.passed,true);
 for(const [k,v] of [['keisen.step-2.table.1-1.塗りつぶし','0'],['keisen.step-2.table.0-0.文字色','R255G0B0']])assert.equal(verifyKeisenReadback({...meta,[k]:v},{canvas,operations}).proof.passed,false);
 const single=copy(drawn);single.cells['1-1']['塗りつぶし']='50';
 const cellOps=[table,{type:'tableAttribute',attribute:'fill',value:50,cell:{row:2,column:2}}];
 const cellMeta=emit({initial,'step-1':drawn,'step-2':single,'before-save':single,reopened:single});
 for(const [k,v] of Object.entries({'始点ﾍﾟｰｼﾞ':'1','始点行':'5','始点桁':'15','終点ﾍﾟｰｼﾞ':'1','終点行':'5','終点桁':'17','単位':'7'}))cellMeta[`keisen.step-2.selection.${k}`]=v;
 assert.equal(verifyKeisenReadback(cellMeta,{canvas,operations:cellOps}).proof.passed,true);
 const badMode={...cellMeta,'keisen.step-2.cellGetterMode':'drawing'};assert.throws(()=>verifyKeisenReadback(badMode,{canvas,operations:cellOps}),/normal-editing/);
 assert.equal(verifyKeisenReadback({...cellMeta,'keisen.step-2.selection.単位':'1'},{canvas,operations:cellOps}).proof.passed,false);
 for(const [k,v] of Object.entries(cellMeta))if(k.includes('.selection.'))meta[k]=v;
 assert.equal(verifyKeisenReadback(meta,{canvas,operations:cellOps}).proof.passed,false,'a whole-table change must fail a single-cell request');
});
test('compiler emits fixed keisen operations and readbacks for save/reopen',()=>{
 const dir=path.resolve('tmp/keisen-compile');const source=compileSample({nonce:'12345678-1234-1234-1234-123456789abc',output:path.join(dir,'document.jtd'),text:recipe.text,settings:{},keisenCanvas:recipe.keisenCanvas,keisenOperations:recipe.samples[4].keisenOperations,resultPath:path.join(dir,'result.txt'),bodyPath:path.join(dir,'body.txt'),donePath:path.join(dir,'done.txt')});
 const t=JSON.parse(fs.readFileSync(new URL('../examples/keisen-cells.json',import.meta.url)));
 const cs=compileSample({nonce:'12345678-1234-1234-1234-123456789abc',output:path.join(dir,'c.jtd'),text:t.text,settings:{},keisenCanvas:t.keisenCanvas,keisenOperations:t.samples[1].keisenOperations,resultPath:path.join(dir,'r.txt'),bodyPath:path.join(dir,'b.txt'),donePath:path.join(dir,'d.txt')});
 assert.match(cs,/Jump\(1,3,1\)\r\nRightCell\(1\)\r\n%a=GetKeisenAttribute\(\)/);
 assert.match(cs,/RangeMode\(7\)\r\nRangeStart\(\)\r\nRangeEnd\(1,1\)/);
 assert.match(source,/KeisenChangeMode\(2,1\)/);assert.match(source,/GetPieceOfKeisen\(\)/);assert.match(source,/keisen.reopened.grid.1.1./);assert.match(source,/^[\x00-\x7f]*$/);
});

test('table resize validates evolving bounds, minimum interiors and operation ordering',()=>{
 const canvas={rows:8,columns:15},t={type:'table',rows:[2,4,6],columns:[3,7,11],lineType:1,color:'R0G0B0'};
 const row={type:'tableResize',axis:'row',index:1,delta:1},column={type:'tableResize',axis:'column',index:2,delta:2};
 const grown=resizeKeisenTable(t,row,canvas);assert.deepEqual(grown.rows,[2,5,7]);assert.deepEqual(t.rows,[2,4,6]);
 assert.deepEqual(resizeKeisenTable(grown,{...row,delta:-1},canvas).rows,t.rows);
 assert.deepEqual(resizeKeisenTable(t,column,canvas).columns,[3,7,13]);
 for(const bad of [{...row,delta:-1},{...row,index:3},{...row,delta:3},{...column,delta:1},{...column,delta:-2},{...column,delta:4}])assert.throws(()=>validateKeisenOperations([t,bad],canvas));
 assert.throws(()=>validateKeisenOperations([row],canvas));
 assert.throws(()=>validateKeisenOperations([t,{type:'tableAttribute',attribute:'fill',value:50},row],canvas));
 assert.equal(validateKeisenOperations([t,row,{...row,delta:-1},column],canvas).length,4);
});

test('resize proof follows changed geometry and rejects stale borders, wrong shifts and outside changes',()=>{
 const canvas={rows:8,columns:15},initial=blank(canvas),t={type:'table',rows:[2,4],columns:[3,7],lineType:1,color:'R0G0B0'};
 function rectangle(bottom,right){
  const state=blank(canvas);
  for(const r of [2,bottom])for(let c=3;c<right;c++){state.grid[`${r}.${c}.通常右.線種`]='1';state.grid[`${r}.${c+1}.通常左.線種`]='1';}
  for(const c of [3,right])for(let r=2;r<bottom;r++){state.grid[`${r}.${c}.半角下.線種`]='1';state.grid[`${r+1}.${c}.半角上.線種`]='1';}
  state.cells['0-0']={'文字揃え':'1','文字色':'R0G0B0','太字':'0','斜体':'0','塗りつぶし':'0','飾り色':'R0G0B0'};return state;
 }
 const drawn=rectangle(4,7),row=rectangle(5,7),column=rectangle(5,9);
 const operations=[t,{type:'tableResize',axis:'row',index:1,delta:1},{type:'tableResize',axis:'column',index:1,delta:2},{type:'tableResize',axis:'row',index:1,delta:-1}];
 const restored=rectangle(4,9),meta=emit({initial,'step-1':drawn,'step-2':row,'step-3':column,'step-4':restored,'before-save':restored,reopened:restored});
 const proof=verifyKeisenReadback(meta,{canvas,operations}).proof;assert.equal(proof.passed,true);assert.deepEqual(proof.checks[2].tableAfter,{rows:[2,5],columns:[3,9]});
 for(const [k,v] of [['keisen.step-2.grid.4.3.通常右.線種','1'],['keisen.step-3.grid.3.9.半角下.線種','0'],['keisen.step-4.grid.7.14.通常右.線種','1']])assert.equal(verifyKeisenReadback({...meta,[k]:v},{canvas,operations}).proof.passed,false);
});

test('division and merging validate cell counts, positions and updated target indices',()=>{
 const canvas={rows:7,columns:15},t={type:'table',rows:[2,6],columns:[3,11],lineType:1,color:'R0G0B0'},d={type:'tableDivide',axis:'row',parts:2},m={type:'tableMerge',axis:'row',boundary:1};
 const two=changeKeisenTopology(t,d);assert.deepEqual(two.rows,[2,4,6]);assert.deepEqual(t.rows,[2,6]);assert.deepEqual(changeKeisenTopology(two,m),t);
 for(const bad of [{...d,parts:3},{...d,axis:'diagonal'},{...d,extra:1}])assert.throws(()=>changeKeisenTopology(t,bad));
 assert.throws(()=>changeKeisenTopology(two,d));assert.throws(()=>changeKeisenTopology(t,m));assert.throws(()=>changeKeisenTopology(two,{...m,boundary:0}));
 assert.throws(()=>changeKeisenTopology({...t,rows:[2,5]},d));assert.throws(()=>changeKeisenTopology({...t,columns:[3,13]},{...d,axis:'column'}));
 const attr={type:'tableAttribute',cell:{row:2,column:1},attribute:'fill',value:50};
 assert.equal(validateKeisenOperations([t,d,attr],canvas).length,3);assert.throws(()=>validateKeisenOperations([t,d,m,attr],canvas));assert.throws(()=>validateKeisenOperations([t,d,attr,m],canvas));
});

test('topology proof maps every child and merged cell and rejects lost attributes or borders',()=>{
 const canvas={rows:7,columns:13},initial=blank(canvas),t={type:'table',rows:[2,6],columns:[3,11],lineType:1,color:'R0G0B0'};
 function state(rows,columns){
  const s=blank(canvas);
  for(const r of rows)for(let c=3;c<11;c++){s.grid[`${r}.${c}.通常右.線種`]='1';s.grid[`${r}.${c+1}.通常左.線種`]='1';}
  for(const c of columns)for(let r=2;r<6;r++){s.grid[`${r}.${c}.半角下.線種`]='1';s.grid[`${r+1}.${c}.半角上.線種`]='1';}
  for(let r=0;r<rows.length-1;r++)for(let c=0;c<columns.length-1;c++)s.cells[`${r}-${c}`]={'文字揃え':'1','文字色':'R0G0B0','太字':'0','斜体':'0','塗りつぶし':'50','飾り色':'R0G0B0'};
  return s;
 }
 const one=state([2,6],[3,11]),rows=state([2,4,6],[3,11]),four=state([2,4,6],[3,7,11]),columns=state([2,6],[3,7,11]);
 const operations=[t,{type:'tableDivide',axis:'row',parts:2},{type:'tableDivide',axis:'column',parts:2},{type:'tableMerge',axis:'row',boundary:1},{type:'tableMerge',axis:'column',boundary:1}];
 const meta=emit({initial,'step-1':one,'step-2':rows,'step-3':four,'step-4':columns,'step-5':one,'before-save':one,reopened:one});
 const proof=verifyKeisenReadback(meta,{canvas,operations}).proof;assert.equal(proof.passed,true);
 assert.deepEqual(proof.checks[1].cellLineage,{'0-0':['0-0'],'1-0':['0-0']});assert.deepEqual(proof.checks[3].cellLineage,{'0-0':['0-0','1-0'],'0-1':['0-1','1-1']});
 for(const [k,v] of [['keisen.step-3.table.1-1.塗りつぶし','0'],['keisen.step-4.grid.4.3.通常右.線種','1'],['keisen.step-2.grid.4.5.通常右.線種','0'],['keisen.step-4.table.0-1.塗りつぶし','0']])assert.equal(verifyKeisenReadback({...meta,[k]:v},{canvas,operations}).proof.passed,false);
 const missing={...meta};delete missing['keisen.step-3.table.1-1.文字色'];assert.throws(()=>verifyKeisenReadback(missing,{canvas,operations}),/missing table getter/);
 const conflicting=copy(four);conflicting.cells['1-0']['塗りつぶし']='60';
 const mergeOnly=[{...t,rows:[2,4,6],columns:[3,7,11]},{type:'tableMerge',axis:'row',boundary:1}];
 const conflictingMeta=emit({initial,'step-1':conflicting,'step-2':columns,'before-save':columns,reopened:columns});
 assert.equal(verifyKeisenReadback(conflictingMeta,{canvas,operations:mergeOnly}).proof.passed,false,'a merge must not hide conflicting parent attributes');
});

test('delegated table attributes require visible topology and preservation, not fixed black single lines',()=>{
 const canvas={rows:5,columns:9},table={type:'table',rows:[2,4],columns:[3,7],lineType:null,color:null};
 const state=blank(canvas);
 for(const y of [2,4])for(let x=3;x<7;x++)for(const pre of [`${y}.${x}.通常右`,`${y}.${x+1}.通常左`]){state.grid[pre+'.線種']='3';state.grid[pre+'.線色']='R0G0B255';}
 for(const x of [3,7])for(let y=2;y<4;y++)for(const pre of [`${y}.${x}.半角下`,`${y+1}.${x}.半角上`]){state.grid[pre+'.線種']='3';state.grid[pre+'.線色']='R0G0B255';}
 state.cells['0-0']={'文字揃え':'1','文字色':'R0G0B0','太字':'0','斜体':'0','塗りつぶし':'0','飾り色':'R0G0B0'};
 const meta=emit({initial:blank(canvas),'step-1':state,'before-save':state,reopened:state});
 assert.equal(verifyKeisenReadback(meta,{canvas,operations:[table]}).proof.passed,true);
 assert.equal(verifyKeisenReadback(meta,{canvas,operations:[{...table,lineType:1,color:'R0G0B0'}]}).proof.passed,false);
 for(const [key,value] of [['keisen.step-1.grid.2.3.通常右.線種','0'],['keisen.reopened.grid.2.3.通常右.線色','R255G0B0'],['keisen.step-1.grid.1.1.通常右.線種','1']])assert.equal(verifyKeisenReadback({...meta,[key]:value},{canvas,operations:[table]}).proof.passed,false);
 assert.doesNotThrow(()=>validateKeisenOperations([table],canvas));
 assert.throws(()=>validateKeisenOperations([table,{type:'tableResize',axis:'row',index:1,delta:1}],canvas),/explicit/);
});
