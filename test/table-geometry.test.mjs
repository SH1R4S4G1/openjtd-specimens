import test from 'node:test';import assert from 'node:assert/strict';
import {createTableGeometry,validateTableGeometry,cellAt,mergeTableCells,splitTableCell,changeTableBand,tableGeometrySegments} from '../src/table-geometry.mjs';
const grid=()=>createTableGeometry([2,4,6],[3,7,11]);
const segments=s=>tableGeometrySegments(s).map(v=>v.join(',')).sort();
test('geometry rejects gaps, overlaps, duplicate IDs and invalid cells',()=>{
 for(const edit of [s=>s.cells.pop(),s=>s.cells.push({...s.cells[0],id:'extra'}),s=>s.cells[1].id=s.cells[0].id,s=>s.cells[0].bottom=0]){
  const s=grid();edit(s);assert.throws(()=>validateTableGeometry(s));
 }
 assert.throws(()=>createTableGeometry([2,3],[3,7]));assert.throws(()=>cellAt(grid(),0,1));
});
test('partial row/column merges preserve T junctions and splitting restores geometry',()=>{
 const original=grid();
 for(const rect of [{top:0,bottom:2,left:0,right:1},{top:0,bottom:1,left:0,right:2}]){
  const merged=mergeTableCells(original,rect);assert.equal(merged.state.cells.length,3);assert.equal(Object.values(merged.lineage)[0].length,2);
  const split=splitTableCell(merged.state,{row:1,column:1,rows:rect.bottom,columns:rect.right});
  assert.equal(split.state.cells.length,4);assert.deepEqual(segments(split.state),segments(original));
 }
 assert.deepEqual(original,grid());
 const merged=mergeTableCells(original,{top:0,bottom:2,left:0,right:1});
 assert.throws(()=>mergeTableCells(merged.state,{top:0,bottom:1,left:0,right:2}),/complete cells/);
});
test('splitting a selected cell leaves neighbors spanning newly introduced axes',()=>{
 const original=createTableGeometry([2,8],[3,11,19]);
 const result=splitTableCell(original,{row:1,column:1,rows:3,columns:2});
 assert.equal(result.state.cells.length,7);const neighbor=cellAt(result.state,1,3);
 assert.equal(neighbor.id,original.cells[1].id);assert.equal(neighbor.bottom-neighbor.top,3);
 assert.equal(Object.keys(result.lineage).length,6);
 assert.throws(()=>splitTableCell(grid(),{row:1,column:1,rows:2}),/minimum interiors/);
});
test('insert/delete before, between and after bands round-trip both axes with explicit lineage',()=>{
 for(const axis of ['row','column'])for(const index of [1,2,3]){
  const original=grid(),added=changeTableBand(original,{axis,mode:'insert',index,size:axis==='row'?2:4});
  assert.equal(added.state.cells.length,6);assert.equal(Object.values(added.lineage).filter(v=>v.length===0).length,2);
  const deleted=changeTableBand(added.state,{axis,mode:'delete',index});assert.deepEqual(segments(deleted.state),segments(original));
  assert.deepEqual(deleted.state.cells,original.cells);assert.equal(deleted.removed.length,2);
 }
 assert.throws(()=>changeTableBand(createTableGeometry([2,4],[3,7]),{axis:'row',mode:'delete',index:1}),/last band/);
 const merged=mergeTableCells(grid(),{top:0,bottom:2,left:0,right:1}).state;
 const added=changeTableBand(merged,{axis:'row',mode:'insert',index:2,size:2});
 assert.equal(added.state.cells.length,4);assert.equal(cellAt(added.state,2,1).bottom,3);
 const restored=changeTableBand(added.state,{axis:'row',mode:'delete',index:2});assert.deepEqual(segments(restored.state),segments(merged));
});
