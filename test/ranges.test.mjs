import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateTargets, validateOperations, verifyRangeReadback } from '../src/ranges.mjs';
import { expandExperiment } from '../src/experiment.mjs';
import { compileSample } from '../src/adapters/macro.mjs';
const recipe=JSON.parse(await readFile(new URL('../examples/character-ranges.json',import.meta.url),'utf8'));
const attributes='和文フォント名,和文スタイル名,欧文フォント名,欧文スタイル名,文字サイズ,縦拡大率,横拡大率,行送り調整,文字色,回転角,傍点,反転,中抜き,影文字,影文字色,アンダーライン,取消ライン,アッパーライン,文字囲い,塗りつぶし,飾り色,字間,字間単位,ベースシフト量,ベースシフト量単位,ベース位置'.split(',');
function synthetic(operations){
  const meta={},text=recipe.text,targets=recipe.targets;
  const chars=Array.from(text,(text,i)=>({text,attr:{...Object.fromEntries(attributes.map(k=>[k,'0'])),'文字サイズ':'10.5','横拡大率':'100','字間単位':'1'},info:{ルビ:'FALSE',均等割付:'FALSE',密着割付:'FALSE',IsCloselySpacing:'FALSE',IsEvenlySpacing:'FALSE'},position:{page:'1',row:'1',column:String(i+1)},type:'21',geometry:{'X方向位置':String(30+i*3.7),'Y方向位置':'35','ページ番号':'1'}}));
  const emit=stage=>{chars.forEach((c,i)=>{for(const [group,fields] of Object.entries(c)){if(group==='text'||group==='type')meta[`range.${stage}.${i}.${group}`]=fields;else for(const [key,v] of Object.entries(fields))meta[`range.${stage}.${i}.${group}.${key}`]=v;}});meta[`range.${stage}.end.0`]=`/0/1/1/1/${text.length+1}`;};
  for(const c of chars)c.ruby={GetRuby:''};
  emit('initial');
  operations.forEach((op,i)=>{
    const target=targets.find(t=>t.id===op.target),stage=`step-${i+1}`;
    meta[`range.${stage}.selected`]=target.expected;
    meta[`range.${stage}.cursor`]=`1/1/${target.start+1}`;
    for(let j=target.start;j<target.end-(op.attribute==='spacing'?1:0);j++){
      const decorationKey={underline:'アンダーライン',strikeThrough:'取消ライン',border:'文字囲い',fill:'塗りつぶし'}[op.attribute];
      if(decorationKey){chars[j].attr[decorationKey]=String(op.mode==='clear'?0:op.value);if(op.color!==undefined)chars[j].attr['飾り色']=op.color;continue;}
      if(op.attribute==='ruby'){
        chars[j].info['ルビ']=op.mode==='clear'?'FALSE':'TRUE';
        chars[j].ruby=op.mode==='clear'?{GetRuby:''}:{GetRuby:op.reading,'ルビ文字':op.reading,'均等割付':String(op.evenly),'文字位置':String(op.position),'サイズ':String(op.sizeMm),'距離':String(op.distanceMm),'ふりがな上下':String(op.placement)};
        continue;
      }
      if(['closely','evenly'].includes(op.attribute)){
        const flag=op.mode==='clear'?'FALSE':'TRUE';
        chars[j].info[op.attribute==='closely'?'密着割付':'均等割付']=flag;
        chars[j].info[op.attribute==='closely'?'IsCloselySpacing':'IsEvenlySpacing']=flag;
        continue;
      }
      chars[j].attr[{scaleX:'横拡大率',size:'文字サイズ',spacing:'字間'}[op.attribute]]=String(op.mode==='clear'?0:op.value);
      if(op.attribute==='spacing')chars[j].attr['字間単位']=String(op.mode==='clear'?1:op.unit);
    }
    emit(stage);
  });emit('before-save');emit('reopened');return meta;
}
test('range recipes preserve explicit targets and ordered steps; reject ambiguous/malformed targets',()=>{
  const plan=expandExperiment(recipe);assert.deepEqual(plan.targets,recipe.targets);assert.equal(plan.samples.at(-1).operations.length,3);
  for(const target of [{...recipe.targets[0],expected:'different'},{...recipe.targets[0],kind:'cell'},{...recipe.targets[0],end:99},{...recipe.targets[0],start:-1}])assert.throws(()=>validateTargets([target],recipe.text));
  for(const text of ['A\nB','😀','a\u0301'])assert.throws(()=>validateTargets(recipe.targets,text));
  for(const op of [{target:'missing',type:'character',attribute:'size',mode:'set',value:12},{target:'middle',type:'character',attribute:'spacing',mode:'set',value:10,unit:3},{target:'middle',type:'character',attribute:'size',mode:'clear'}])assert.throws(()=>validateOperations([op],recipe.targets));
});

test('ruby requires explicit reading and verifies lifecycle, decoration, and outside ruby state',()=>{
  const base={target:'middle',type:'character',attribute:'ruby',mode:'set',reading:'たいしょう'};
  const operations=validateOperations([base,{...base,mode:'modify',reading:'よみ',evenly:0,position:3,sizeMm:4,distanceMm:0.5,placement:2},{target:'middle',type:'character',attribute:'ruby',mode:'clear'}],recipe.targets);
  assert.equal(operations[0].sizeMm,3);assert.equal(operations[0].evenly,1);
  for(const invalid of [{...base,reading:''},{...base,reading:'a\nb'},{...base,reading:'a'.repeat(65)},{...base,sizeMm:1},{...base,placement:0},{...base,attribute:'size'}])assert.throws(()=>validateOperations([invalid],recipe.targets));
  assert.throws(()=>validateOperations([{...base,mode:'modify'}],recipe.targets));
  assert.equal(verifyRangeReadback(synthetic(operations),{...recipe,operations}).proof.passed,true);
  for(const [key,value] of [['range.step-1.2.ruby.GetRuby','別'],['range.step-2.2.ruby.距離','0'],['range.step-2.2.ruby.文字位置','1'],['range.step-2.0.ruby.GetRuby','漏れ'],['range.reopened.2.info.ルビ','TRUE']]){
    const meta=synthetic(operations);meta[key]=value;
    if(key==='range.reopened.2.info.ルビ')assert.throws(()=>verifyRangeReadback(meta,{...recipe,operations}));
    else assert.equal(verifyRangeReadback(meta,{...recipe,operations}).proof.passed,false);
  }
  const meta=synthetic(operations);delete meta['range.step-1.2.ruby.サイズ'];assert.throws(()=>verifyRangeReadback(meta,{...recipe,operations}));
});

test('decoration rejects unsafe arguments and checks requested values, shared color and unrelated attributes',()=>{
  const op={target:'middle',type:'character',attribute:'underline',mode:'set',value:1,color:'R000G128B255'};
  assert.equal(validateOperations([op],recipe.targets)[0].color,'R0G128B255');
  for(const bad of [{...op,color:'R256G0B0'},{...op,color:'R1G2B3\nRuby(0)'},{...op,value:16},{...op,attribute:'fill',value:108},{...op,value:0},{...op,mode:'clear'},{...op,attribute:'size'},{...op,unit:1}])assert.throws(()=>validateOperations([bad],recipe.targets));
  const operations=validateOperations([op,{target:'middle',type:'character',attribute:'border',mode:'set',value:3,color:'R255G0B0'},{target:'middle',type:'character',attribute:'border',mode:'clear'}],recipe.targets);
  const result=verifyRangeReadback(synthetic(operations),{...recipe,operations});assert.equal(result.proof.passed,true);assert.equal(result.proof.checks[2].strength,'exact-decoration-and-unrequested-state');
  for(const [key,value] of [['range.step-2.2.attr.文字囲い','1'],['range.step-2.2.attr.飾り色','R0G0B255'],['range.step-3.2.attr.アンダーライン','0'],['range.step-1.0.attr.アンダーライン','1'],['range.reopened.2.attr.文字囲い','3']]){const meta=synthetic(operations);meta[key]=value;assert.equal(verifyRangeReadback(meta,{...recipe,operations}).proof.passed,false);}
});

test('allocation lifecycle validation, presence proof and unverified width are explicit',()=>{
  const op={target:'middle',type:'character',attribute:'evenly',mode:'set',value:10,unit:101,widthMode:1};
  const operations=[op,{...op,mode:'modify',value:12},{target:'middle',type:'character',attribute:'evenly',mode:'clear'}];
  assert.deepEqual(validateOperations(operations,recipe.targets),operations);
  for(const invalid of [[operations[1]],[operations[2]],[op,op],[{...op,value:0}],[{...op,unit:100}],[{...op,widthMode:3}]])assert.throws(()=>validateOperations(invalid,recipe.targets));
  for(const ops of [operations,[{target:'middle',type:'character',attribute:'closely',mode:'set'},{target:'middle',type:'character',attribute:'closely',mode:'clear'}]]){
    const meta=synthetic(ops),result=verifyRangeReadback(meta,{...recipe,operations:ops});
    assert.equal(result.proof.passed,true);assert.equal(result.proof.checks[0].strength,'dedicated-getter-presence-only-per-character');
    if(ops[0].attribute==='evenly')assert.equal(result.proof.checks[0].widthVerified,false);
    meta['range.step-1.0.info.均等割付']='TRUE';meta['range.step-1.0.info.IsEvenlySpacing']='TRUE';
    assert.equal(verifyRangeReadback(meta,{...recipe,operations:ops}).proof.passed,false);
    const missing=synthetic(ops);delete missing['range.reopened.0.info.IsEvenlySpacing'];assert.throws(()=>verifyRangeReadback(missing,{...recipe,operations:ops}));
  }
});

test('allocation getter disagreements remain visible and cannot disguise a failed dedicated getter',()=>{
  const operations=[{target:'middle',type:'character',attribute:'closely',mode:'set'},{target:'middle',type:'character',attribute:'closely',mode:'clear'}];
  const meta=synthetic(operations);
  for(const stage of ['step-2','before-save','reopened'])for(const i of [2,3])meta[`range.${stage}.${i}.info.密着割付`]='TRUE';
  const result=verifyRangeReadback(meta,{...recipe,operations});
  assert.equal(result.proof.passed,true);assert.equal(result.proof.getterDisagreements.length,6);
  meta['range.step-2.2.info.IsCloselySpacing']='TRUE';
  assert.equal(verifyRangeReadback(meta,{...recipe,operations}).proof.passed,false);
});

test('evenly compiler remaps empty cursor slots and cancels using an interior block',()=>{
  const root=path.resolve('tmp/allocation-compiler'),op={target:'middle',type:'character',attribute:'evenly',mode:'set',value:8,unit:101,widthMode:1};
  const operations=[op,{target:'middle',type:'character',attribute:'evenly',mode:'clear'}];
  const source=compileSample({nonce:'12345678-1234-1234-1234-123456789abc',output:path.join(root,'document.jtd'),text:recipe.text,settings:{},targets:recipe.targets,operations,resultPath:path.join(root,'result.txt'),bodyPath:path.join(root,'body.txt'),donePath:path.join(root,'done.txt')});
  // Empty cursor slots are skipped by GetCharacter, stopping at a paragraph end (type 10).
  assert.ok(source.includes('if GetCharacterType() = 10 then')&&source.includes('%rp3=%off'));
  assert.match(source,/RangeMode\(5\)\r\nRangeStart\(\)\r\nCursorLeft\(1\)\r\nRangeEnd\(1,1\)/);
  assert.match(source,/IsEvenlySpacing\(\)/);assert.ok(source.includes('range.initial.skipped.'));
  assert.match(source,/^[\x00-\x7f]*$/);
});
test('compiler records the target start cursor, checks the selected string, then reselects',()=>{
  const root=path.resolve('tmp/range-compiler');
  const source=compileSample({nonce:'12345678-1234-1234-1234-123456789abc',output:path.join(root,'document.jtd'),text:recipe.text,settings:{},targets:recipe.targets,operations:recipe.samples[1].operations,resultPath:path.join(root,'result.txt'),bodyPath:path.join(root,'body.txt'),donePath:path.join(root,'done.txt')});
  assert.match(source,/^[\x00-\x7f]*$/);assert.ok(source.includes('RangeMode(1)\r\nRangeStart()'));
  const first=source.indexOf('range.step-1.cursor=');assert.ok(first>0&&source.indexOf('%ct=GetString(1)',first)>first);
  // Readback walks sequentially: no per-character range selection or jump from the start.
  const snapshotPart=source.slice(source.indexOf('range.initial.'),source.indexOf('range-operation-1'));
  assert.ok(!snapshotPart.includes('RangeMode(1)')&&!snapshotPart.includes('GetRange()'));
  const guard=source.indexOf('if %joined =');const setter=source.indexOf('CharacterAttribute(,,,,,,120)',guard);
  // The setter runs after reselecting, inside the guard (the reselection walk has its own if/end if).
  assert.ok(source.indexOf('RangeStart()',guard)<setter);
  const afterSetter=source.slice(setter);assert.ok(afterSetter.indexOf('end if')<afterSetter.indexOf('range.step-1.'));
});
test('width and spacing checks cover all outside characters and the spacing terminal guard',()=>{
  for(const operations of [recipe.samples[1].operations,recipe.samples[3].operations,recipe.samples.at(-1).operations]){
    const result=verifyRangeReadback(synthetic(operations),{...recipe,operations});assert.equal(result.proof.passed,true);
    assert.equal(result.proof.checks[0].outsideCharacters,4);
    assert.equal(result.proof.checks[0].terminalGuards,operations[0].attribute==='spacing'?1:0);
  }
});
test('wrong selection, spillover, missing getter, coordinate drift and reopen changes cannot pass',()=>{
  const operations=recipe.samples[1].operations;
  for(const [key,value] of [['range.step-1.selected','乙対'],['range.step-1.0.attr.横拡大率','120'],['range.step-1.cursor','1/1/1'],['range.reopened.end.0','余/21/0/1/1/7'],['range.before-save.end.0','/0/0/1/2/1'],['range.reopened.end.0','/0/1/1/2/1'],['range.reopened.2.attr.横拡大率','121'],['range.initial.0.text','乙']]){
    const meta=synthetic(operations);meta[key]=value;assert.equal(verifyRangeReadback(meta,{...recipe,operations}).proof.passed,false);
  }
  const missing=synthetic(operations);delete missing['range.reopened.0.info.ルビ'];assert.throws(()=>verifyRangeReadback(missing,{...recipe,operations}));
});

test('delegated ruby defaults preserve automatic NIL without asserting a fabricated numeric size',()=>{
 const explicit=validateOperations([{target:'middle',type:'character',attribute:'ruby',mode:'set',reading:'よみ'}],recipe.targets);
 const operations=explicit.map(op=>({...op,evenly:null,position:null,sizeMm:null,distanceMm:null,placement:null}));
 const meta=synthetic(explicit);
 for(const key of Object.keys(meta))if(key.endsWith('.ruby.サイズ'))meta[key]='';
 assert.equal(verifyRangeReadback(meta,{...recipe,operations}).proof.passed,true);
 assert.equal(verifyRangeReadback(meta,{...recipe,operations:explicit}).proof.passed,false);
 const changed={...meta};changed['range.reopened.2.ruby.サイズ']='3';
 assert.equal(verifyRangeReadback(changed,{...recipe,operations}).proof.passed,false);
 const missing={...meta};delete missing['range.step-1.2.ruby.サイズ'];assert.throws(()=>verifyRangeReadback(missing,{...recipe,operations}));
 const bad={...meta};bad['range.step-1.2.ruby.サイズ']='garbage';assert.equal(verifyRangeReadback(bad,{...recipe,operations}).proof.passed,false);
 const normalized=validateOperations(operations,recipe.targets);assert.equal(normalized[0].sizeMm,null);
});
