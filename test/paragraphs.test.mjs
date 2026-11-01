import test from 'node:test';
import assert from 'node:assert/strict';
import {paragraphMacro,paragraphDecorationCommand,validateParagraphTargets,validateParagraphOperations,verifyParagraphReadback,PARAGRAPH_KEYS} from '../src/paragraphs.mjs';
const text='前段落\n対象段落\n後段落',targets=[{id:'middle',index:2,expected:'対象段落'}];
test('paragraph color and fill use separate arguments, reject unsafe values, and clear both visual components',()=>{
 const make=(attribute,value)=>({target:'middle',attribute,mode:'set',value});
 for(const value of ['R256G0B0','R01G0B0','r1g2b3','R1G2B3"\nend','red',1])assert.throws(()=>validateParagraphOperations([make('decorationColor',value)],targets));
 for(const value of [-1,108,1.5,'25',NaN])assert.throws(()=>validateParagraphOperations([make('decorationFill',value)],targets));
 for(const value of [0,25,100,101,107])assert.equal(validateParagraphOperations([make('decorationFill',value)],targets)[0].value,value);
 const color=make('decorationColor','R255G0B0');validateParagraphOperations([color],targets);
 assert.equal(paragraphDecorationCommand(color,JSON.stringify),'ParagraphDecoration(1,1,1,1,1,1,"R255G0B0",2,0,"R170G170B170",2,0,"R0G0B0",0,0,0,0)');
 assert.equal(paragraphDecorationCommand(make('decorationFill',107),JSON.stringify),'ParagraphDecoration(1,1,1,1,1,1,"R0G0B0",2,0,"R170G170B170",2,107,"R0G0B0",0,0,0,0)');
 assert.equal(paragraphDecorationCommand({attribute:'decorationFill',mode:'clear'},JSON.stringify),'ParagraphDecoration(0,1,1,1,1,1,"R0G0B0",2,0,"R170G170B170",2,0,"R0G0B0",0,0,0,0)');
 assert.throws(()=>validateParagraphOperations([color,make('decorationFill',25)],targets),/single-attribute/);
});
test('getter-less paragraph decoration never becomes verified from unchanged paragraph getters',()=>{
 const operations=[{target:'middle',attribute:'decorationLine',mode:'set',value:3},{target:'middle',attribute:'decorationLine',mode:'clear'}];
 const macro=paragraphMacro({text,targets,operations,q:JSON.stringify}).apply.join('\n');
 assert.match(macro,/ParagraphDecoration\(0,/);assert.doesNotMatch(macro,/CancelParagraphDecoration/);
 assert.throws(()=>validateParagraphOperations([{...operations[0],value:1.5}],targets));
 assert.throws(()=>validateParagraphOperations([{...operations[0],unit:1}],targets));
 const meta={};for(const phase of ['initial','step-1','step-2','before-save','reopened'])for(let p=1;p<=3;p++){
  const prefix=`paragraph.${phase}.${p}.`,line=text.split('\n')[p-1];
  for(let k=0;k<23;k++)meta[prefix+'field.'+k]='';
  meta[prefix+'textCount']='1';meta[prefix+'text.1']=line;
  for(const [k,c] of [...line].entries()){meta[prefix+'char.'+k]=c;meta[prefix+'charType.'+k]='21';}
 }
 const result=verifyParagraphReadback(meta,{text,targets,operations});
 assert.deepEqual(result.differences,[]);assert.equal(result.proof.passed,false);
 assert.equal(result.proof.reviewRequired,true);assert.equal(result.proof.decorationVerified,false);
 assert.ok(verifyParagraphReadback({...meta,'paragraph.reopened.1.field.0':'2'},{text,targets,operations}).differences.length);
});
test('paragraph targets use paragraph identity and reject wrong text, aliases and mixed attributes',()=>{
 assert.deepEqual(validateParagraphTargets(targets,text),targets);
 assert.throws(()=>validateParagraphTargets([{...targets[0],expected:'別'}],text));
 assert.throws(()=>validateParagraphTargets([...targets,{...targets[0],id:'other'}],text));
 assert.throws(()=>validateParagraphOperations([{target:'middle',attribute:'alignment',mode:'clear'}],targets));
 // Numeric attributes with exact getters may be combined; tabs and decoration stay isolated.
 assert.equal(validateParagraphOperations([{target:'middle',attribute:'alignment',mode:'set',value:2},{target:'middle',attribute:'indentStart',mode:'set',value:5,unit:1}],targets).length,2);
 assert.equal(validateParagraphOperations([{target:'middle',attribute:'alignment',mode:'set',value:2},{target:'middle',attribute:'tabs',mode:'set',value:[5],unit:1}],targets).length,2);
 assert.throws(()=>validateParagraphOperations([{target:'middle',attribute:'alignment',mode:'set',value:2},{target:'middle',attribute:'decorationLine',mode:'set',value:1}],targets),/single-attribute/);
 assert.deepEqual(validateParagraphOperations([{target:'middle',attribute:'indent',mode:'set',value:{start:2,firstStart:1},unit:101}],targets)[0].value,{start:2,firstStart:1});
 for(const value of [{},{start:-1},{firstEnd:1},{start:11},{unknown:1}])assert.throws(()=>validateParagraphOperations([{target:'middle',attribute:'indent',mode:'set',value,unit:1}],targets));
 assert.throws(()=>validateParagraphOperations([{target:'middle',attribute:'paragraphSpacing',mode:'set',value:{before:5},unit:101}],targets),/invalid unit/);
});
test('paragraph macros control indent linkage and explicitly protect unrelated clear groups',()=>{
 const operations=[{target:'middle',attribute:'indentStart',mode:'set',value:5,unit:1},{target:'middle',attribute:'indentStart',mode:'clear'}];
 const m=paragraphMacro({text,targets,operations,q:JSON.stringify}).apply.join('\n');
 assert.match(m,/NextParagraph\(1\)/);assert.match(m,/RangeMode\(3\)/);
 assert.match(m,/ParagraphAttribute\(,,5,0,0,0,1\)/);
 assert.match(m,/CancelParagraphAttribute\(false,false,true,false,false,false,false,false,false,false,false,false,false\)/);
});
test('paragraph proof requires exact target values, unset status, text and every outside paragraph',()=>{
 const operations=[{target:'middle',attribute:'alignment',mode:'set',value:2},{target:'middle',attribute:'alignment',mode:'set',value:3},{target:'middle',attribute:'alignment',mode:'clear'}];
 const meta={};for(const [phase,value] of [['initial',''],['step-1','2'],['step-2','3'],['step-3',''],['before-save',''],['reopened','']])for(let p=1;p<=3;p++){
  const base=`paragraph.${phase}.${p}.`;for(let k=0;k<PARAGRAPH_KEYS.length;k++)meta[base+'field.'+k]=p===2&&k===0?value:'';
  for(const [k,c] of [...text.split('\n')[p-1]].entries()){meta[base+'char.'+k]=c;meta[base+'charType.'+k]='21';}
  meta[base+'textCount']='1';meta[base+'text.1']=text.split('\n')[p-1];
 }
 assert.equal(verifyParagraphReadback(meta,{text,targets,operations}).proof.passed,true);
 for(const [key,value] of [['paragraph.step-1.1.field.0','2'],['paragraph.step-2.2.field.0','2'],['paragraph.step-3.2.field.0','0'],['paragraph.reopened.2.text.1','別'],['paragraph.initial.3.field.1','0']])assert.equal(verifyParagraphReadback({...meta,[key]:value},{text,targets,operations}).proof.passed,false,key);
 const missing={...meta};delete missing['paragraph.reopened.1.field.0'];assert.throws(()=>verifyParagraphReadback(missing,{text,targets,operations}),/missing/);
});

test('tab positions require ordered arrays and a space cannot substitute for a verified tab',()=>{
 const text='前\n甲\t乙\n後',targets=[{id:'middle',index:2,expected:'甲\t乙'}],operations=[{target:'middle',attribute:'tabs',mode:'set',value:[5,10],unit:1}];
 assert.throws(()=>validateParagraphOperations([{...operations[0],value:[10,5]}],targets));
 const macro=paragraphMacro({text,targets,operations,q:JSON.stringify}).apply.join('\n');assert.match(macro,/\{5,10\},1,,\{1,1\}/);
 const meta={};for(const stage of ['initial','step-1','before-save','reopened'])for(let p=1;p<=3;p++){
  const prefix=`paragraph.${stage}.${p}.`,line=text.split('\n')[p-1];
  for(let k=0;k<23;k++)meta[prefix+'field.'+k]=stage!=='initial'&&p===2?(k===19?'[5,10]':k===20?'1':''):'';
  meta[prefix+'textCount']='1';meta[prefix+'text.1']=line.replaceAll('\t',' ');
  for(const [k,c] of [...line].entries()){meta[prefix+'char.'+k]=c==='\t'?' ':c;meta[prefix+'charType.'+k]=c==='\t'?'9':'21';}
 }
 assert.equal(verifyParagraphReadback(meta,{text,targets,operations}).proof.passed,true);
 for(const [key,value] of [['paragraph.step-1.2.field.19','[5,11]'],['paragraph.reopened.2.charType.1','20']])assert.equal(verifyParagraphReadback({...meta,[key]:value},{text,targets,operations}).proof.passed,false);
});

test('CR-007: a paragraph rewrapped by later columns is unchanged; a changed attribute, character or text is named', () => {
  // As pm1-col3 (openjtd-pagemark-r1): alignment on paragraph 1, then three columns
  // rewrap every paragraph into two physical lines before save and after reopening.
  const text = '段組みと見出しの確かめの一つ目です。\n二つ目の段落もここに書きます。\n三つ目の段落で終わります。';
  const targets = [{ id: 'paragraph-0', index: 1, expected: '段組みと見出しの確かめの一つ目です。' }];
  const operations = [{ target: 'paragraph-0', attribute: 'alignment', mode: 'set', value: 1 }];
  const lines = text.split('\n'), meta = {};
  for (const phase of ['initial', 'step-1', 'before-save', 'reopened']) for (let p = 1; p <= 3; p++) {
    const prefix = `paragraph.${phase}.${p}.`, line = lines[p - 1];
    for (let k = 0; k < 23; k++) meta[prefix + 'field.' + k] = phase !== 'initial' && p === 1 && k === 0 ? '1' : '';
    for (const [k, c] of [...line].entries()) { meta[prefix + 'char.' + k] = c; meta[prefix + 'charType.' + k] = '21'; }
    const physical = ['before-save', 'reopened'].includes(phase) ? [line.slice(0, 11), line.slice(11)] : [line];
    meta[prefix + 'textCount'] = String(physical.length);
    physical.forEach((part, j) => { meta[prefix + 'text.' + (j + 1)] = part; });
  }
  const result = verifyParagraphReadback(meta, { text, targets, operations });
  assert.deepEqual(result.differences, []);
  assert.deepEqual([result.proof.passed, result.proof.reopened], [true, true]);
  assert.deepEqual(result.snapshots.reopened[1].textLines, ['二つ目の段落もここに書', 'きます。']); // kept as evidence
  // What did change is named per paragraph and field, not as the whole snapshot.
  const fields = changes => verifyParagraphReadback({ ...meta, ...changes }, { text, targets, operations }).differences.map(d => `${d.phase}:${d.field}`);
  assert.deepEqual(fields({ 'paragraph.reopened.2.field.0': '2' }), ['reopened:paragraph.2.attributes']);
  assert.deepEqual(fields({ 'paragraph.before-save.3.charType.0': '20' }), ['before-save:paragraph.3.characters']);
  assert.deepEqual(fields({ 'paragraph.reopened.1.text.2': '一つ目でした。' }), ['reopened:paragraph.1.text', 'reopened:paragraph.1.text']);
  const attributes = verifyParagraphReadback({ ...meta, 'paragraph.reopened.2.field.0': '2' }, { text, targets, operations }).differences[0];
  assert.deepEqual([attributes.expected[0], attributes.actual[0]], [null, 2]);
});
