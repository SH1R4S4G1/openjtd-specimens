import test from 'node:test';import assert from 'node:assert/strict';
import {planFootnotes} from '../src/footnote-sequence.mjs';
const text='甲乙丙丁\n戊己庚辛\n壬癸子丑';
const add=(id,paragraph,offset,text='脚注')=>({action:'add',id,paragraph,offset,text});
test('footnote positions remain logical across out-of-order insertion, replacement and removal',()=>{
 const steps=[add('last',2,0),add('middle',0,2),add('first',0,0),{action:'modify',id:'middle',text:'変更'},{action:'remove',id:'first'},add('end',1,4),{action:'remove',id:'middle'}];
 const before=structuredClone(steps),p=planFootnotes({steps},text);assert.deepEqual(steps,before);
 assert.deepEqual(p.states[3].body,['1甲乙2丙丁','戊己庚辛','3壬癸子丑']);assert.equal(p.states[3].notes.find(n=>n.id==='middle').cursorOffset,3);
 assert.equal(p.states[4].notes.find(n=>n.id==='middle').text,'変更');assert.deepEqual(p.states[5].body,['甲乙1丙丁','戊己庚辛','2壬癸子丑']);
 assert.deepEqual(p.states.at(-1).body,['甲乙丙丁','戊己庚辛1','2壬癸子丑']);
});
test('invalid footnote history cannot accidentally target another note',()=>{
 for(const steps of [[{action:'remove',id:'absent'}],[add('a',0,5)],[add('a',0,1),add('b',0,1)],[add('a',0,1),{action:'remove',id:'a'},add('a',0,2)],[add('a',0,1),{action:'modify',id:'a',text:'変更',offset:2}],[add('a',0,1,'😀')],Array(1)])assert.throws(()=>planFootnotes({steps},text));
 const p=planFootnotes({steps:[add('a',0,0),{action:'remove',id:'a'}]},text);assert.deepEqual(p.states.at(-1).notes,[]);assert.equal(p.states.at(-1).body.join('\n'),text);
});
import {verifyFootnoteSequence} from '../src/footnote-sequence.mjs';
function readings(plan){const meta={},prefixes={};const put=(k,v)=>meta['footnotes.'+k]=String(v);const lines=(k,rows)=>{put(k+'.count',rows.length);rows.forEach((v,i)=>put(k+'.line.'+(i+1),v));};
 for(const [i,op] of plan.trial.steps.entries()){if(op.action==='add'){put('operation.'+i+'.area',3);prefixes[op.id]='*1';lines('prefix.'+op.id,['*1']);}else{const n=plan.states[i].notes.find(n=>n.id===op.id);put('operation.'+i+'.number',n.number);if(op.action==='modify'){put('operation.'+i+'.area',3);[...n.text].forEach((c,j)=>put('operation.'+i+'.old.'+j,c));}}}
 for(const [stage,state] of [['initial',plan.states[0]],...plan.states.slice(1).map((s,i)=>['step-'+(i+1),s]),['before-save',plan.states.at(-1)],['reopened',plan.states.at(-1)]]){put(stage+'.bodyArea',1);lines(stage+'.body',state.body);for(const n of state.notes){const b=stage+'.note.'+n.id;for(const [k,v] of Object.entries({number:n.number,bodyChar:n.number,area:3,returnArea:1,returnNumber:n.number}))put(b+'.'+k,v);lines(b+'.text',[prefixes[n.id]+n.text]);}if(state.notes.length)lines(stage+'.allNotes',state.notes.map(n=>prefixes[n.id]+n.text));else{put(stage+'.emptyAreaOpen','TRUE');put(stage+'.emptyJumpArea',1);}}
 return meta;
}
test('sequence proof requires each note identity, whole body and area contents at every stage',()=>{
 const trial={steps:[add('a',0,1),add('b',1,2),{action:'modify',id:'a',text:'変更'},{action:'remove',id:'b'}]},plan=planFootnotes(trial,text),meta=readings(plan);
 assert.equal(verifyFootnoteSequence(meta,{text,trial}).proof.passed,true);
 for(const [k,v] of [['footnotes.reopened.note.a.returnNumber','2'],['footnotes.step-3.note.a.text.line.1','*1間違い'],['footnotes.operation.2.old.0','誤'],['footnotes.reopened.body.line.3','本文変更'],['footnotes.reopened.allNotes.line.1','*1残留別注']])assert.equal(verifyFootnoteSequence({...meta,[k]:v},{text,trial}).proof.passed,false);
 // The note-area label may show the current body-order number instead of the captured prefix.
 const numbered=verifyFootnoteSequence({...meta,'footnotes.reopened.note.a.text.line.1':'1変更','footnotes.reopened.allNotes.line.1':'1変更'},{text,trial});
 assert.equal(numbered.proof.passed,true);assert.equal(numbered.snapshots.reopened.notes[0].prefixForm,'number');
 for(const [k,v] of [['footnotes.reopened.note.a.text.line.1','2変更'],['footnotes.reopened.allNotes.line.1','1別']])assert.equal(verifyFootnoteSequence({...meta,[k]:v},{text,trial}).proof.passed,false);
 // After an earlier note is removed, the label may keep the number the note had when created.
 const shift={steps:[add('x',0,0),add('y',2,0),{action:'remove',id:'x'}]},shifted=readings(planFootnotes(shift,text));
 Object.assign(shifted,{'footnotes.reopened.note.y.text.line.1':'2脚注','footnotes.reopened.allNotes.line.1':'2脚注'});
 const kept=verifyFootnoteSequence(shifted,{text,trial:shift});assert.equal(kept.proof.passed,true);assert.equal(kept.snapshots.reopened.notes[0].prefixForm,'earlier-number');
 assert.equal(verifyFootnoteSequence({...shifted,'footnotes.reopened.note.y.text.line.1':'3脚注'},{text,trial:shift}).proof.passed,false);
 const missing={...meta};delete missing['footnotes.reopened.note.a.area'];assert.throws(()=>verifyFootnoteSequence(missing,{text,trial}));
 const clear={steps:[add('a',0,0),{action:'remove',id:'a'}]},data=readings(planFootnotes(clear,text));Object.assign(data,{'footnotes.reopened.emptyJumpArea':'3','footnotes.reopened.emptyNotes.count':'1','footnotes.reopened.emptyNotes.line.1':'残留脚注'});assert.equal(verifyFootnoteSequence(data,{text,trial:clear}).proof.passed,false);
});

import fs from 'node:fs/promises';
import {compileCatalog} from '../src/sample-catalog.mjs';
import {expandExperiment} from '../src/experiment.mjs';
test('public footnotes compile final-state positions canonically and reject ambiguous anchors',async()=>{
 const c=JSON.parse(await fs.readFile('examples/agent/12-footnotes.json','utf8')),before=structuredClone(c),jobs=compileCatalog(c).jobs;
 assert.deepEqual(c,before);assert.equal(jobs[0].recipe.samples[0].footnote.steps.length,3);
 c.samples[0].document.notes.reverse();assert.deepEqual(compileCatalog(c).jobs,jobs);
 assert.deepEqual(expandExperiment(jobs[0].recipe).samples[0].footnote,{steps:[]});
 for(const mutate of [d=>d.notes[0].offset=5,d=>d.notes[0].paragraph=3,d=>d.notes[0].id=d.notes[1].id,d=>{d.notes[0].paragraph=d.notes[1].paragraph;d.notes[0].offset=d.notes[1].offset;},d=>d.text='😀',d=>d.font={sizePt:12}]){const bad=structuredClone(before);mutate(bad.samples[0].document);assert.throws(()=>compileCatalog(bad));}
 assert.deepEqual(jobs.at(-1).recipe.samples[0].footnote,{steps:[]});
});
