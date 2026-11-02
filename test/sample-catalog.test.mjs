import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { compileCatalog, validateCatalog, writeCompilation, loadCatalog } from '../src/sample-catalog.mjs';
import { SAMPLE_SCHEMA } from '../src/sample-schema.mjs';
import { assertSupportedSchema, validateSchema, oneOfDiscriminator } from '../src/schema-validation.mjs';
import { buildCapabilities } from '../src/sample-capabilities.mjs';
import { expandExperiment } from '../src/experiment.mjs';
import { compileSample } from '../src/adapters/macro.mjs';
import { checkContract } from '../scripts/check-contract.mjs';

const fixture=()=>({schemaVersion:1,id:'test-catalog',samples:[{id:'test-sample',title:'ルビ試料',purpose:'読みの解析',feature:'ruby',
  expected:[{property:'ruby.reading',value:'たいしょう'}],document:{kind:'text',text:'甲乙対象丙丁',annotations:[
    {capability:'ruby',range:{start:2,end:4,text:'対象'},parameters:{reading:'たいしょう'}},
  ]}}]});
const annotation=input=>input.samples[0].document.annotations[0];
const cli=args=>spawnSync(process.execPath,['bin/ichitaro.mjs',...args],{encoding:'utf8'});
async function temporary(t) {const dir=await fs.mkdtemp(path.join(tmpdir(),'sample-contract-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}

test('generated capabilities, all canonical examples and documentation references stay current',checkContract);

test('canonical catalogs compile through the existing recipe and macro compiler without Ichitaro',async()=>{
  for (const file of (await fs.readdir('examples/agent')).filter(f=>f.endsWith('.json'))) {
    const catalog=await loadCatalog(path.join('examples/agent',file));
    if(catalog.kind==='pdf-from-jtd')continue; // a PDF Catalog has no recipes (test/pdf-catalog.test.mjs)
    const compiled=compileCatalog(catalog);
    for (const job of compiled.jobs) {
      const plan=expandExperiment(job.recipe);
      assert.equal(plan.samples.length,job.controlSampleId?3:2);
      assert.equal(plan.samples[1].id,job.outputSampleId);
      for (const sample of plan.samples) {
        const root=path.resolve('tmp/macro-contract-test');
        const source=compileSample({nonce:'12345678-1234-1234-1234-123456789abc',output:path.join(root,'document.jtd'),
          resultPath:path.join(root,'result.txt'),bodyPath:path.join(root,'body.txt'),donePath:path.join(root,'done.txt'),
          text:plan.text,settings:sample.settings,features:sample.features,footnote:sample.footnote,layoutPriority:sample.layoutPriority,targets:plan.targets,operations:sample.operations,
          keisenCanvas:plan.keisenCanvas,keisenOperations:sample.keisenOperations});
        assert.ok(source.includes('SaveDocument('));
        if(sample.footnote?.steps?.length)assert.ok(source.includes('Footnote('));
      }
    }
  }
});

test('compiler preserves test intent, does not mutate requests, and separates recipes from metadata',()=>{
  const input=fixture();Object.assign(input.samples[0],{testIntent:'regression',tags:['ruby'],prerequisites:['font installed']});
  const original=structuredClone(input),compiled=compileCatalog(input);
  assert.deepEqual(input,original);assert.deepEqual(compiled.catalog,original);
  assert.notEqual(compiled.catalog,input);
  assert.equal(compiled.jobs[0].recipe.samples[0].operations[0].reading,'たいしょう');
  assert.equal(compiled.jobs[0].recipe.purpose,undefined);
  assert.equal(validateCatalog(input).expectedEvaluation,'not-performed');
});

test('schema rejects missing fields, unknown fields, versions, capabilities and macro injection',()=>{
  const mutations=[
    v=>delete v.samples[0].purpose, v=>v.schemaVersion=2, v=>v.schemaVersion='1',
    v=>v.samples[0].feature='imaginary',v=>annotation(v).capability='paragraph-attribute',
    v=>v.samples[0].macro='Ruby()',v=>v.samples[0].document.operations=[],
    v=>annotation(v).parameters.extra=1,v=>annotation(v).range.end='4',
    v=>v.samples[0].expected=[{property:'x',value:{arbitrary:true}}],
    v=>v.samples[0].document.font={},v=>v.samples[0].document.font={sizePt:51},
    v=>v.samples[0].document.text='😀',v=>v.samples[0].document.text='a\tb',
    v=>v.samples[0].document.text='a\u0301',v=>v.samples[0].document.text='x'.repeat(60001),
    v=>v.samples[0].document.font={name:'😀'},
  ];
  for (const mutate of mutations) {const input=fixture();mutate(input);assert.throws(()=>compileCatalog(input),{code:'ERR_SAMPLE_SCHEMA'});}
  // Paragraph breaks are allowed, but not empty paragraphs (semantic check).
  const empty=fixture();empty.samples[0].document.text='甲乙対象丙丁'+String.fromCharCode(10);assert.throws(()=>compileCatalog(empty),{code:'ERR_SAMPLE_SEMANTIC'});
});

test('all metadata and nested structures are closed by JSON Schema',()=>{
  for (const select of [v=>v,v=>v.samples[0],v=>v.samples[0].document,v=>v.samples[0].expected[0],annotation,v=>annotation(v).range,v=>annotation(v).parameters]) {
    const input=fixture();select(input).invented=true;
    assert.throws(()=>validateSchema(input,SAMPLE_SCHEMA),{code:'ERR_SAMPLE_SCHEMA'});
  }
});

test('semantic checks reject text mismatches, invalid ranges, overlap, feature mismatch and one-character spacing',()=>{
  const mutations=[v=>annotation(v).range.text='別物',v=>annotation(v).range.end=2,
    v=>v.samples[0].document.annotations.push(structuredClone(annotation(v))),
    v=>v.samples[0].feature='keisen-table',
    v=>{v.samples[0].feature='closely-spacing';Object.assign(annotation(v),{capability:'closely-spacing',range:{start:2,end:3,text:'対'},parameters:{}});},
  ];
  for (const mutate of mutations) {const input=fixture();mutate(input);assert.throws(()=>compileCatalog(input),{code:'ERR_SAMPLE_SEMANTIC'});}
});

test('sample identity and related sample references cannot silently collide',()=>{
  for (const id of ['baseline','con','lpt1']) {const input=fixture();input.samples[0].id=id;assert.throws(()=>compileCatalog(input),/reserved/);}
  const duplicate=fixture();duplicate.samples.push(structuredClone(duplicate.samples[0]));assert.throws(()=>compileCatalog(duplicate),/duplicate/);
  const input=fixture();input.samples[0].relatedSamples=['missing'];assert.throws(()=>compileCatalog(input),/relatedSamples/);
  input.samples[0].relatedSamples=['test-sample'];assert.throws(()=>compileCatalog(input),/relatedSamples/);
  input.samples.push({...structuredClone(input.samples[0]),id:'related',relatedSamples:[]});input.samples[0].relatedSamples=['related'];assert.doesNotThrow(()=>compileCatalog(input));
});

test('bounds and named units map to execution units; declarative ordering is canonical',()=>{
  for (const [capability,parameters,field,value] of [
    ['character-scaleX',{percent:50},'value',50],['character-size',{points:500},'value',500],
    ['character-spacing',{value:-176.4,unit:'mm'},'unit',1],['character-spacing',{value:200,unit:'percent'},'unit',100],
    ['evenly-spacing',{width:100,unit:'character'},'unit',101],['ruby',{reading:'よみ',placement:'below'},'placement',2],
  ]) {const input=fixture();input.samples[0].feature=capability;Object.assign(annotation(input),{capability,parameters});assert.equal(compileCatalog(input).jobs[0].recipe.samples[0].operations[0][field],value);}
  const input=fixture();input.samples[0].document.annotations.push({...structuredClone(annotation(input)),range:{start:0,end:2,text:'甲乙'}});
  const forward=compileCatalog(input);input.samples[0].document.annotations.reverse();assert.deepEqual(compileCatalog(input).jobs,forward.jobs);
});

test('invalid parameter extremes and unsupported tables never compile',()=>{
  for (const [capability,parameters] of [['character-scaleX',{percent:201}],['character-size',{points:2}],
    ['character-spacing',{value:177,unit:'mm'}],['character-spacing',{value:1,unit:'pixel'}],
    ['evenly-spacing',{width:0,unit:'mm'}],['ruby',{reading:'よみ',sizeMm:1}],['closely-spacing',{value:1}]]) {
    const input=fixture();input.samples[0].feature=capability;Object.assign(annotation(input),{capability,parameters});assert.throws(()=>compileCatalog(input));
  }
  for (const document of [{kind:'keisen-table',rows:3,columns:2},{kind:'keisen-table',rows:1,columns:1,text:'cell'}]) {
    const input=fixture();input.samples[0].document=document;input.samples[0].feature='keisen-table';assert.throws(()=>compileCatalog(input));
  }
});

test('JSON-only API rejects accessors without calling them, nonfinite values and cycles',()=>{
  const input=fixture();let called=false;Object.defineProperty(input,'id',{get(){called=true;return 'bad';}});
  assert.throws(()=>compileCatalog(input));assert.equal(called,false);
  const cyclic=fixture();cyclic.loop=cyclic;assert.throws(()=>compileCatalog(cyclic));
  const bad=fixture();bad.samples[0].expected[0].value=NaN;assert.throws(()=>compileCatalog(bad));
  assert.throws(()=>assertSupportedSchema({not:{}}),/Unsupported schema keyword/);
});

test('compilation outputs link original expectations to each recipe by ID and hashes without overwrite',async t=>{
  const dir=await temporary(t),destination=path.join(dir,'compiled'),input=fixture();
  await writeCompilation(input,destination);
  assert.deepEqual(await loadCatalog(path.join(destination,'request.json')),input);
  const manifest=await loadCatalog(path.join(destination,'compilation.json'));
  for (const [filename,expectedHash] of [[manifest.requestFile,manifest.requestSha256],...manifest.jobs.map(j=>[j.recipeFile,j.recipeSha256])]) {
    const bytes=await fs.readFile(path.join(destination,filename));assert.equal(createHash('sha256').update(bytes).digest('hex'),expectedHash);
  }
  assert.equal(manifest.jobs[0].sampleId,input.samples[0].id);
  await assert.rejects(writeCompilation(input,destination),{code:'EEXIST'});
  const invalid=fixture();invalid.schemaVersion=2;
  await assert.rejects(writeCompilation(invalid,path.join(dir,'invalid')));
  await assert.rejects(fs.stat(path.join(dir,'invalid')),{code:'ENOENT'});
});

test('CLI supports BOM, validation and compilation; errors return nonzero JSON without desktop access',async t=>{
  const dir=await temporary(t),input=path.join(dir,'catalog.json');
  await fs.writeFile(input,'\uFEFF'+JSON.stringify(fixture()));
  const validated=cli(['validate',input]);assert.equal(validated.status,0,validated.stderr);assert.equal(JSON.parse(validated.stdout).ok,true);
  const compiled=cli(['compile',input,path.join(dir,'compiled')]);assert.equal(compiled.status,0,compiled.stderr);
  const recipe=path.join(dir,'compiled','test-sample.recipe.json');assert.equal(cli(['plan',recipe]).status,0);
  for (const args of [['validate'],['validate',input,'extra'],['compile',input],['compile',input,path.join(dir,'compiled')]]) {
    const result=cli(args);assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).ok,false);
  }
  await fs.writeFile(input,'{broken');const result=cli(['validate',input]);assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).error.code,'ERR_SAMPLE_INPUT');
});

test('machine capabilities distinguish execution implementation from request availability',()=>{
  const entries=new Map(buildCapabilities().capabilities.map(c=>[c.id,c]));
  assert.equal(entries.get('ruby').requestSupported,true);
  assert.equal(entries.get('keisen-table-topology').status,'implemented');
  assert.equal(entries.get('keisen-table-topology').requestSupported,false);
  assert.equal(entries.get('paragraph-decoration').status,'implemented');
  assert.equal(entries.get('paragraph-decoration').requestSupported,false);
  assert.equal(entries.get('paragraph-attribute').requestSupported,true);
  assert.equal(entries.get('paragraph-decoration').status,'implemented');
  assert.match(entries.get('evenly-spacing').limitations.join(' '),/NOT verified/);
});

const tableFixture=()=>{
  const input=fixture();input.samples[0].feature='keisen-table';
  input.samples[0].document={kind:'keisen-table',rows:2,columns:2,cells:[
    {row:2,column:2,attributes:{bold:1,alignment:3}},
    {row:1,column:1,attributes:{color:'R255G0B0',fill:50}},
  ]};return input;
};
test('table final states normalize cell and attribute order without altering request metadata',()=>{
  const input=tableFixture(),original=structuredClone(input),compiled=compileCatalog(input);
  const operations=compiled.jobs[0].recipe.samples[0].keisenOperations;
  assert.deepEqual(operations.slice(1).map(op=>[op.cell,op.attribute,op.value]),[
    [{row:1,column:1},'fill',50],[{row:1,column:1},'color','R255G0B0'],
    [{row:2,column:2},'alignment',3],[{row:2,column:2},'bold',1],
  ]);
  assert.deepEqual(input,original);assert.deepEqual(compiled.catalog,original);
  input.samples[0].document.cells.reverse();
  for(const cell of input.samples[0].document.cells)cell.attributes=Object.fromEntries(Object.entries(cell.attributes).reverse());
  assert.deepEqual(compileCatalog(input).jobs,compiled.jobs);
  assert.equal(operations[0].lineType,null);assert.equal(operations[0].color,null);
  Object.assign(input.samples[0].document,{lineType:15,color:'R255G255B255'});
  const changed=compileCatalog(input).jobs[0].recipe.samples[0].keisenOperations[0];
  assert.equal(changed.lineType,15);assert.equal(changed.color,'R255G255B255');
});
test('table requests reject ambiguous targets, invalid attributes and excessive operations',()=>{
  for(const mutate of [
    d=>d.cells.push(structuredClone(d.cells[0])),d=>d.rows=1,
    d=>d.cells=[{row:1,column:1,attributes:{alignment:1,textColor:'R0G0B0',bold:0,italic:0,fill:0,color:'R0G0B0'}},
      {row:2,column:2,attributes:{bold:1,italic:1}}],
    d=>d.cells[0].text='本文',d=>d.cells[0].text='　',d=>{d.rows=3;},d=>{d.merges=[{from:{row:1,column:1},to:{row:1,column:2}}];},
  ]){const input=tableFixture();mutate(input.samples[0].document);assert.throws(()=>compileCatalog(input),{code:'ERR_SAMPLE_SEMANTIC'});}
  for(const mutate of [d=>d.cells[0].row=0,d=>d.cells[0].attributes={},d=>d.cells[0].text='',d=>d.cells[0].text='一二三四五',
    d=>d.cells[0].attributes.bold=true,d=>d.cells[0].attributes.alignment=4,d=>d.cells[0].attributes.fill=108,
    d=>d.lineType=16,...['R256G0B0','R00G0B0','R0G0B0\n','red'].map(color=>d=>d.color=color),
  ]){const input=tableFixture();mutate(input.samples[0].document);assert.throws(()=>compileCatalog(input),{code:'ERR_SAMPLE_SCHEMA'});}
  const input=tableFixture();input.samples[0].document.cells=[
    {row:1,column:1,attributes:{alignment:1,textColor:'R0G0B0',bold:0,italic:0,fill:0,color:'R0G0B0'}},
    {row:2,column:2,attributes:{fill:107}},
  ];assert.equal(compileCatalog(input).jobs[0].recipe.samples[0].keisenOperations.length,8);
});

test('decoration annotations compile to a stable final state with one shared color',()=>{
  const input=fixture();input.samples[0].feature='character-decoration';
  input.samples[0].document.annotations=[{capability:'character-decoration',range:{start:2,end:4,text:'対象'},parameters:{fill:50,color:'R0G0B255',underline:15}}];
  const ops=compileCatalog(input).jobs[0].recipe.samples[0].operations;
  assert.deepEqual(ops.map(op=>[op.attribute,op.value,op.color]),[['underline',15,'R0G0B255'],['fill',50,'R0G0B255']]);
  annotation(input).parameters={color:'R1G2B3'};
  assert.throws(()=>compileCatalog(input),/requires underline, strikeThrough or fill/);
  annotation(input).parameters={};
  assert.throws(()=>compileCatalog(input),{code:'ERR_SAMPLE_SCHEMA',path:'$.samples[0].document.annotations[0].parameters',
    message:'$.samples[0].document.annotations[0].parameters: object must not be empty'});
  input.samples[0].feature='character-border';
  input.samples[0].document.annotations=[{capability:'character-border',range:{start:0,end:2,text:'甲乙'},parameters:{lineType:3}}];
  assert.deepEqual(compileCatalog(input).jobs[0].recipe.samples[0].operations,[{target:'range-0',type:'character',attribute:'border',mode:'set',value:3}]);
  annotation(input).parameters={lineType:16};
  assert.throws(()=>compileCatalog(input));
});

test('schema errors follow the kind or capability a value names and list the supported values otherwise',()=>{
  // Positive: a correct catalog with two annotations passes.
  const two=()=>{const input=fixture();input.samples[0].document.annotations.push({capability:'character-color',range:{start:4,end:6,text:'丙丁'},parameters:{color:'R255G0B0'}});return input;};
  assert.equal(validateCatalog(two()).ok,true);
  const error=(mutate,expected)=>{const input=two();mutate(input);assert.throws(()=>compileCatalog(input),expected);};
  // A known capability with a wrong parameter: the branch's own error, with its deep location.
  error(v=>Object.assign(v.samples[0].document.annotations[1],{capability:'character-decoration',parameters:{underline:1,bold:1}}),
    {code:'ERR_SAMPLE_SCHEMA',path:'$.samples[0].document.annotations[1].parameters',message:'$.samples[0].document.annotations[1].parameters: unknown field bold'});
  error(v=>v.samples[0].document.annotations[1].parameters={color:'red'},
    {path:'$.samples[0].document.annotations[1].parameters.color',message:'$.samples[0].document.annotations[1].parameters.color: does not match the required form: Color as R<0-255>G<0-255>B<0-255> in decimal without leading zeros or spaces, for example R0G0B0 or R255G0B0 (got "red")'});
  // A nested oneOf (spacing units) is explained the same way.
  error(v=>Object.assign(v.samples[0].document.annotations[1],{capability:'character-spacing',parameters:{value:1,unit:'pt'}}),
    {message:'$.samples[0].document.annotations[1].parameters.unit: unknown unit "pt"; supported: mm, percent'});
  // An unknown capability: every supported value is listed, read from the schema.
  const capabilities=SAMPLE_SCHEMA.$defs.annotation.oneOf.map(branch=>branch.properties.capability.const);
  assert.ok(capabilities.includes('character-font-style')&&capabilities.length>=11);
  for (const name of ['Bold','bold'])
    error(v=>v.samples[0].document.annotations[1].capability=name,
      {code:'ERR_SAMPLE_SCHEMA',path:'$.samples[0].document.annotations[1].capability',message:`$.samples[0].document.annotations[1].capability: unknown capability "${name}"; supported: ${capabilities.join(', ')}`});
  // document.kind: the same rule through $ref branches.
  error(v=>v.samples[0].document.kind='table',
    {path:'$.samples[0].document.kind',message:'$.samples[0].document.kind: unknown kind "table"; supported: text, keisen-table, footnotes, paragraphs'});
  error(v=>{v.samples[0].feature='keisen-table';v.samples[0].document={kind:'keisen-table',rows:5,columns:2};},
    {path:'$.samples[0].document.rows',message:'$.samples[0].document.rows: must be between 1 and 4 (got 5)'});
  error(v=>v.samples[0].document.annotation=[],{message:'$.samples[0].document: unknown field annotation'});
  // Without the discriminator in the value, or for a value that is not an object, the general message stays.
  error(v=>delete v.samples[0].document.annotations[1].capability,
    {message:'$.samples[0].document.annotations[1]: must match exactly one supported structure (check kind/capability, required fields, unknown fields and parameter bounds)'});
  for (const value of ['x',null,[]])
    error(v=>v.samples[0].document.annotations[1]=value,{message:'$.samples[0].document.annotations[1]: must match exactly one supported structure (check kind/capability, required fields, unknown fields and parameter bounds)'});
  // The discriminator is found from the schema, not by name; no discriminator or
  // two matching branches keep the general message.
  const shapes={$defs:{a:{type:'object',additionalProperties:false,properties:{shape:{const:'a'},n:{type:'integer'}},required:['shape']},
    b:{type:'object',additionalProperties:false,properties:{shape:{const:'b'}},required:['shape']},via:{$ref:'#/$defs/b'}},oneOf:[{$ref:'#/$defs/a'},{$ref:'#/$defs/via'}]};
  assert.throws(()=>validateSchema({shape:'c'},shapes),{path:'$.shape',message:'$.shape: unknown shape "c"; supported: a, b'});
  assert.throws(()=>validateSchema({shape:'a',n:'1'},shapes),{path:'$.n',message:'$.n: must have type integer'});
  assert.throws(()=>validateSchema({shape:'b',n:1},shapes),{message:'$: unknown field n'});
  assert.doesNotThrow(()=>validateSchema({shape:'a',n:1},shapes));
  assert.throws(()=>validateSchema(true,{oneOf:[{type:'string'},{type:'number'}]}),/^Error: \$: must match exactly one supported structure/);
  assert.throws(()=>validateSchema(1,{oneOf:[{type:'number'},{type:'integer'}]}),/\$: must match exactly one supported structure/);
  // A const shared by two branches does not discriminate.
  assert.throws(()=>validateSchema({k:'x'},{oneOf:[{properties:{k:{const:'x'}},required:['y']},{properties:{k:{const:'x'}},required:['z']}]}),/\$: must match exactly one supported structure/);
});

test('schema errors give the value and the allowed range, and a pattern by its description',()=>{
  const error=(mutate,message)=>{const input=fixture();mutate(input);assert.throws(()=>compileCatalog(input),{code:'ERR_SAMPLE_SCHEMA',message});};
  // Numbers: the range and the value.
  error(v=>{v.samples[0].feature='character-decoration';Object.assign(annotation(v),{capability:'character-decoration',parameters:{underline:16}});},
    '$.samples[0].document.annotations[0].parameters.underline: must be between 1 and 15 (got 16)');
  error(v=>annotation(v).range.start=-3,'$.samples[0].document.annotations[0].range.start: must be between 0 and 59999 (got -3)');
  // One-sided bounds say only the bound that exists.
  assert.throws(()=>validateSchema(-3,{type:'integer',minimum:0}),{message:'$: must be at least 0 (got -3)'});
  assert.throws(()=>validateSchema(60,{type:'number',maximum:50}),{message:'$: must be at most 50 (got 60)'});
  // String and array lengths: the actual length, the range and the string, cut after 40 characters.
  error(v=>v.samples[0].title='題'.repeat(201),`$.samples[0].title: string length 201 is outside 1..200 (got "${'題'.repeat(40)}"…)`);
  error(v=>v.samples[0].title='','$.samples[0].title: string length 0 is outside 1..200 (got "")');
  error(v=>v.samples[0].expected=[],'$.samples[0].expected: array length 0 is outside 1..32');
  error(v=>v.samples[0].tags=Array.from({length:21},(_,i)=>`t${i}`),'$.samples[0].tags: array length 21 is outside 0..20');
  assert.throws(()=>validateSchema('',{type:'string',minLength:1}),{message:'$: string length 0 is below the minimum 1 (got "")'});
  assert.throws(()=>validateSchema([],{type:'array',minItems:1}),{message:'$: array length 0 is below the minimum 1'});
  // Patterns: the schema description names the form; without one the pattern itself is shown.
  error(v=>{v.samples[0].feature='character-color';Object.assign(annotation(v),{capability:'character-color',parameters:{color:'R256G0B0'}});},
    '$.samples[0].document.annotations[0].parameters.color: does not match the required form: Color as R<0-255>G<0-255>B<0-255> in decimal without leading zeros or spaces, for example R0G0B0 or R255G0B0 (got "R256G0B0")');
  error(v=>v.samples[0].id='Ruby','$.samples[0].id: does not match the required form: Identifier: 1..60 characters, a lowercase letter a-z first, then a-z, 0-9 or hyphens (got "Ruby")');
  error(v=>annotation(v).parameters.reading='よ\tみ','$.samples[0].document.annotations[0].parameters.reading: does not match the required form: Ruby reading: 1..64 BMP characters without U+0000..U+001F, U+007F or combining marks (got "よ\\tみ")');
  // A long description gives its first sentence only.
  error(v=>v.samples[0].document.text='a\tb','$.samples[0].document.text: does not match the required form: 1..60000 BMP characters without U+0000..U+0009, U+000B..U+001F, U+007F or combining marks (LF, U+000A, is allowed) (got "a\\tb")');
  assert.throws(()=>validateSchema('x',{type:'string',pattern:'^[0-9]+$'}),{message:'$: does not match the required pattern ^[0-9]+$ (got "x")'});
  // Every pattern of the Sample Catalog schema has a description, which accepts the same values as before.
  const missing=[];
  const walk=(node,at)=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach((child,i)=>walk(child,`${at}[${i}]`));return;}
    if(typeof node.pattern==='string'&&!node.description)missing.push(at);for(const [key,child] of Object.entries(node))walk(child,`${at}.${key}`);};
  walk(SAMPLE_SCHEMA,'$');assert.deepEqual(missing,[]);
  // Positive: a correct catalog still passes.
  assert.equal(validateCatalog(fixture()).ok,true);
});

test('every oneOf of the Sample Catalog schema has a discriminator, so its errors keep their location',()=>{
  const found=[];
  const walk=node=>{
    if(!node||typeof node!=='object')return;
    if(Array.isArray(node)){node.forEach(walk);return;}
    if(node.oneOf){const key=oneOfDiscriminator(node.oneOf,SAMPLE_SCHEMA);assert.ok(key,JSON.stringify(node).slice(0,120));found.push(key.name);}
    Object.values(node).forEach(walk);
  };
  walk(SAMPLE_SCHEMA);
  assert.deepEqual([...new Set(found)].sort(),['capability','kind','layoutPriority','unit']);
});

test('range errors name the annotation index, the text found at the offsets and the counting rule',()=>{
  // The wrong annotation is second in the request but first after sorting by start.
  const input=fixture();input.samples[0].document.annotations.push({capability:'character-color',range:{start:0,end:2,text:'甲丙'},parameters:{color:'R255G0B0'}});
  assert.throws(()=>compileCatalog(input),{code:'ERR_SAMPLE_SEMANTIC',path:'test-sample',
    message:'test-sample: annotations[1].range: text "甲丙" is not the text at [0,2) (found "甲乙"; body length 6; start counts from 0 and end is exclusive)'});
  const empty=fixture();annotation(empty).range={start:4,end:2,text:'対象'};
  assert.throws(()=>compileCatalog(empty),{message:'test-sample: annotations[0].range: end 2 must be greater than start 4 (text "対象"; body length 6; start counts from 0 and end is exclusive)'});
  const past=fixture();annotation(past).range={start:5,end:7,text:'丁'};
  assert.throws(()=>compileCatalog(past),{message:'test-sample: annotations[0].range: [5,7) runs past the end of the body (text "丁"; found "丁"; body length 6; start counts from 0 and end is exclusive)'});
  // A line feed counts as one character in the body length and the offsets.
  const lines=fixture();lines.samples[0].document.text='甲乙\n対象丙丁';annotation(lines).range={start:2,end:4,text:'対象'};
  assert.throws(()=>compileCatalog(lines),{message:'test-sample: annotations[0].range: text "対象" is not the text at [2,4) (found "\\n対"; body length 7; start counts from 0 and end is exclusive)'});
  annotation(lines).range={start:3,end:5,text:'対象'};assert.equal(validateCatalog(lines).ok,true);
});

test('annotation errors name both overlapping annotations by their request index, and a decoration without a value',()=>{
  const twoOnSameRange=()=>{const input=fixture();input.samples[0].feature='character-decoration';input.samples[0].document.annotations=[
    {capability:'character-decoration',range:{start:2,end:4,text:'対象'},parameters:{fill:50}},
    {capability:'character-color',range:{start:2,end:4,text:'対象'},parameters:{color:'R255G255B255'}}];return input;};
  assert.throws(()=>compileCatalog(twoOnSameRange()),{code:'ERR_SAMPLE_SEMANTIC',path:'test-sample',
    message:'test-sample: annotations[1] (character-color [2,4) "対象") overlaps annotations[0] (character-decoration [2,4) "対象"); annotations must not overlap even with different capabilities'});
  // The indexes are those of the request, not of the order by start.
  const reversed=fixture();reversed.samples[0].document.annotations=[
    {capability:'character-color',range:{start:3,end:5,text:'象丙'},parameters:{color:'R255G0B0'}},
    {capability:'ruby',range:{start:0,end:4,text:'甲乙対象'},parameters:{reading:'こうおつたいしょう'}}];
  assert.throws(()=>compileCatalog(reversed),{message:'test-sample: annotations[0] (character-color [3,5) "象丙") overlaps annotations[1] (ruby [0,4) "甲乙対象"); annotations must not overlap even with different capabilities'});
  // A long range text is cut after 40 characters.
  const long=fixture();long.samples[0].feature='character-color';long.samples[0].document={kind:'text',text:'あ'.repeat(60),annotations:[
    {capability:'character-color',range:{start:0,end:50,text:'あ'.repeat(50)},parameters:{color:'R255G0B0'}},
    {capability:'character-size',range:{start:10,end:12,text:'ああ'},parameters:{points:20}}]};
  assert.throws(()=>compileCatalog(long),{message:`test-sample: annotations[1] (character-size [10,12) "ああ") overlaps annotations[0] (character-color [0,50) "${'あ'.repeat(40)}"…); annotations must not overlap even with different capabilities`});
  // Positive: adjacent ranges with different capabilities pass.
  const adjacent=twoOnSameRange();adjacent.samples[0].document.annotations[1].range={start:4,end:6,text:'丙丁'};
  assert.equal(validateCatalog(adjacent).ok,true);
  // A decoration without underline, strikeThrough or fill is named by its index.
  const bare=twoOnSameRange();bare.samples[0].document.annotations[1]={capability:'character-decoration',range:{start:4,end:6,text:'丙丁'},parameters:{color:'R1G2B3'}};
  assert.throws(()=>compileCatalog(bare),{message:'test-sample: annotations[1]: character-decoration requires underline, strikeThrough or fill'});
});

test('table errors name the cell or merge by its request index and position, with the text and the allowed length',()=>{
  const table=document=>{const input=fixture();input.samples[0].feature='keisen-table';input.samples[0].document={kind:'keisen-table',...document};return input;};
  const error=(document,message)=>assert.throws(()=>compileCatalog(table(document)),{code:'ERR_SAMPLE_SEMANTIC',message:`test-sample: ${message}`});
  const structured={rows:3,columns:3,lineType:1,color:'R0G0B0'};
  // Cell text: the cell, the text, its length, the allowed length and the width.
  error({rows:2,columns:2,cells:[{row:1,column:1,attributes:{bold:1}},{row:2,column:2,text:'本文'}]},
    'cells[1] (row 2, column 2): cell text must be non-whitespace BMP characters, at most 1 for a cell of width 4 half-width columns (min(4, width/2-1)); got "本文", 2 characters');
  error({rows:2,columns:2,cells:[{row:1,column:2,text:'　'}]},
    'cells[0] (row 1, column 2): cell text must be non-whitespace BMP characters, at most 1 for a cell of width 4 half-width columns (min(4, width/2-1)); got "　", 1 character');
  error({...structured,merges:[{from:{row:1,column:1},to:{row:1,column:2}}],cells:[{row:1,column:1,text:'一二三四'}]},
    'cells[0] (row 1, column 1): cell text must be non-whitespace BMP characters, at most 3 for a merged cell of width 8 half-width columns (min(4, width/2-1)); got "一二三四", 4 characters');
  // Cells outside the table, repeated or inside a merge.
  error({rows:2,columns:2,cells:[{row:1,column:1,text:'甲'},{row:3,column:1,text:'乙'}]},'cells[1] (row 3, column 1): cell outside requested table of 2 rows and 2 columns');
  error({rows:2,columns:2,cells:[{row:2,column:2,text:'甲'},{row:1,column:1,text:'乙'},{row:2,column:2,attributes:{bold:1}}]},
    'cells[2] (row 2, column 2): duplicate cell specification (cells[0] has the same position)');
  error({...structured,merges:[{from:{row:2,column:2},to:{row:3,column:3}}],cells:[{row:1,column:1,text:'甲'},{row:3,column:3,text:'乙'}]},
    'cells[1] (row 3, column 3): a merged cell is addressed by its top-left position; this cell is inside merges[0] (row 2, column 2)-(row 3, column 3), so write (row 2, column 2)');
  // Merges by their from and to.
  error({...structured,rows:2,columns:2,merges:[{from:{row:1,column:1},to:{row:3,column:1}}]},'merges[0] (row 1, column 1)-(row 3, column 1): merge outside requested table of 2 rows and 2 columns');
  error({...structured,merges:[{from:{row:2,column:2},to:{row:1,column:2}}]},'merges[0] (row 2, column 2)-(row 1, column 2): merge needs from at the top-left and at least two cells');
  error({...structured,merges:[{from:{row:2,column:2},to:{row:3,column:3}},{from:{row:1,column:1},to:{row:2,column:2}}]},
    'merges[0] (row 2, column 2)-(row 3, column 3): merges overlap; (row 2, column 2) is already in merges[1] (row 1, column 1)-(row 2, column 2)');
  // Two merges that share only their top-left cell are an overlap too (the top-left cell owns itself, so coordinates alone did not show it).
  error({...structured,merges:[{from:{row:1,column:1},to:{row:1,column:2}},{from:{row:1,column:1},to:{row:2,column:1}}]},
    'merges[1] (row 1, column 1)-(row 2, column 1): merges overlap; (row 1, column 1) is already in merges[0] (row 1, column 1)-(row 1, column 2)');
  error({...structured,merges:[{from:{row:1,column:1},to:{row:2,column:1}},{from:{row:1,column:1},to:{row:1,column:2}}]},
    'merges[1] (row 1, column 1)-(row 1, column 2): merges overlap; (row 1, column 1) is already in merges[0] (row 1, column 1)-(row 2, column 1)');
  // Sizes and totals.
  error({...structured,rowHeights:[2,2]},'rowHeights/columnWidths need one entry per row/column (rowHeights has 2 for 3 rows, columnWidths 3 for 3 columns)');
  error({...structured,columnWidths:[6,5,4]},'columnWidths are half-width units and must be even (full-width character boundaries); columnWidths[1] is 5');
  error({...structured,rowHeights:[4,4,4]},'table exceeds the observation canvas: total row height <= 9 lines, total column width <= 18 half-width columns (got 12 lines and 12 half-width columns)');
  error({rows:2,columns:2,cells:[{row:1,column:1,attributes:{alignment:1,textColor:'R0G0B0',bold:0,italic:0,fill:0,color:'R0G0B0'}},{row:2,column:2,attributes:{bold:1,italic:1}}]},
    'at most seven cell texts and attributes in total for a table up to 2x2 without merges (got 8)');
  error({...structured,cells:Array.from({length:9},(_,i)=>({row:1+Math.floor(i/3),column:1+i%3,attributes:{bold:1,italic:1}}))},
    'at most fifteen merges, cell texts and attributes in total (got 18)');
  error({...structured,leadingParagraphs:[{text:'甲'},{text:'乙',spacing:{unit:'mm',before:1,after:12}}]},
    'leadingParagraphs[1].spacing: leading paragraph spacing in mm must be 0..10 (got before 1, after 12)');
  // Positive: a correct table with a merge, texts and attributes passes.
  assert.equal(validateCatalog(table({...structured,merges:[{from:{row:2,column:2},to:{row:3,column:3}}],
    cells:[{row:2,column:2,text:'結合',attributes:{fill:20}},{row:1,column:1,text:'甲'}]})).ok,true);
});

test('paragraph errors name the paragraph or the format by its index',()=>{
  const doc=document=>{const input=fixture();input.samples[0].feature='paragraph-attribute';input.samples[0].document={kind:'paragraphs',text:'甲\n乙\n丙',...document};return input;};
  const error=(document,message)=>assert.throws(()=>compileCatalog(doc(document)),{code:'ERR_SAMPLE_SEMANTIC',message:`test-sample: ${message}`});
  error({paragraphFormats:[{paragraph:0,alignment:'center'},{paragraph:5,alignment:'right'}]},
    'paragraphFormats[1]: paragraph index outside text (paragraph 5; the text has paragraphs 0..2)');
  error({paragraphFormats:[{paragraph:1,alignment:'center'},{paragraph:0,alignment:'left'},{paragraph:1,alignment:'right'}]},
    'paragraphFormats[2]: duplicate paragraph format (paragraphFormats[0] also formats paragraph 1)');
  error({text:'甲\n乙 乙\n丙',paragraphFormats:[{paragraph:0,alignment:'center'}]},
    'text must be 1..8 paragraphs separated by LF, each 1..24 non-whitespace BMP characters (tabs only with paragraphFormats alone); paragraph 1 (counting from 0) is "乙 乙", 3 characters');
  error({text:'甲\n乙\n丙\n丁\n戊\n己\n庚\n辛\n壬',paragraphFormats:[{paragraph:0,alignment:'center'}]},
    'text must be 1..8 paragraphs separated by LF, each 1..24 non-whitespace BMP characters (tabs only with paragraphFormats alone); got 9 paragraphs');
  error({text:'甲\n乙',paragraphFormats:[{paragraph:0,alignment:'center'}]},'paragraphFormats requires 3..8 paragraphs (got 2)');
  error({text:'甲\n乙',headerFooter:{position:'header',text:'見出し'}},'headerFooter requires exactly 3 paragraphs (got 2)');
  error({text:'甲\n乙',columns:2},'columns requires 3..8 paragraphs (got 2)');
  error({text:'甲\n乙\n丙\n丁',columns:2,columnRange:{from:1,to:4}},'columnRange must lie inside the text and must not cover the whole document (from 1, to 4; the text has paragraphs 0..3)');
  // A text document names its empty paragraph.
  const empty=fixture();empty.samples[0].document.text='甲乙対象丙丁\n\n戊';
  assert.throws(()=>compileCatalog(empty),{message:'test-sample: paragraphs separated by LF must not be empty; paragraph 1 (counting from 0) is empty'});
  // Positive: formats in any order pass.
  assert.equal(validateCatalog(doc({paragraphFormats:[{paragraph:2,alignment:'right'},{paragraph:0,alignment:'center'}]})).ok,true);
});

test('CLI validation errors carry the deep path of a schema error',async t=>{
  const dir=await temporary(t),file=path.join(dir,'catalog.json'),input=fixture();annotation(input).capability='Bold';
  await fs.writeFile(file,JSON.stringify(input));
  const result=cli(['validate',file]);assert.equal(result.status,1);
  const {error}=JSON.parse(result.stderr);
  assert.equal(error.code,'ERR_SAMPLE_SCHEMA');assert.equal(error.path,'$.samples[0].document.annotations[0].capability');
  assert.match(error.message,/unknown capability "Bold"; supported: character-scaleX, /);
});

test('paragraphs documents compile header/footer and columns and reject unsupported shapes',()=>{
  const input=fixture();const sample=input.samples[0];sample.feature='document-header';
  sample.document={kind:'paragraphs',text:'甲\n乙\n丙',headerFooter:{position:'footer',text:'脚部'},pageBreaks:true};
  const variant=compileCatalog(input).jobs[0].recipe.samples[0];
  assert.deepEqual([variant.headerSteps,variant.headerPosition,variant.headerPages,variant.features],[['脚部'],2,3,undefined]);
  sample.document={kind:'paragraphs',text:'甲\n乙',headerFooter:{position:'header',text:'見出し'}};
  assert.throws(()=>compileCatalog(input),/exactly 3 paragraphs/);
  sample.document={kind:'paragraphs',text:'甲\n乙\n丙',headerFooter:{position:'header',text:'見出し'},columns:2,font:{sizePt:12},page:{paper:'B5',orientation:'portrait'}};
  const combined=compileCatalog(input).jobs[0];
  assert.deepEqual([combined.recipe.samples[0].headerSteps,combined.recipe.samples[0].documentColumns,combined.recipe.samples[0].features],[['見出し'],[2],{font:{size:12,sizeUnit:3},paper:{name:'B5 単票・縦方向'}}]);
  assert.ok(['document-header','document-columns-body','document-font','document-paper'].every(id=>combined.capabilities.includes(id)));
  sample.document={kind:'paragraphs',text:'甲\n乙\n丙',columns:2,notes:[{id:'n',paragraph:0,offset:1,text:'注'}]};
  assert.throws(()=>compileCatalog(input),/notes combine only with headerFooter/);
  sample.document={kind:'paragraphs',text:'甲\n乙\n丙',headerFooter:{position:'header',text:'見出し'},pageBreaks:true,columns:2};
  assert.throws(()=>compileCatalog(input),/pageBreaks \(three pages\) cannot combine/);
  sample.document={kind:'paragraphs',text:'甲\n乙\n丙'};
  assert.throws(()=>compileCatalog(input),/at least one of/);
  sample.feature='document-columns-body';sample.document={kind:'paragraphs',text:'甲\n乙\n丙',columns:3,pageBreaks:true};
  assert.throws(()=>compileCatalog(input),/pageBreaks requires headerFooter/);
  sample.document={kind:'paragraphs',text:'甲\n乙\n丙',columns:3};
  assert.deepEqual(compileCatalog(input).jobs[0].recipe.samples[0].documentColumns,[3]);
  sample.document={kind:'paragraphs',text:'甲 乙\n丙\n丁',columns:2};
  assert.throws(()=>compileCatalog(input),/non-whitespace/);
});

test('repeat expands to separate jobs and control adds an unchanged re-save of the baseline',()=>{
  const input=fixture();Object.assign(input.samples[0],{repeat:3,control:true});
  const compiled=compileCatalog(input);
  assert.deepEqual(compiled.jobs.map(job=>[job.sampleId,job.recipeFile,job.requestSampleId,job.repeat,job.controlSampleId]),[1,2,3].map(k=>[`test-sample-r${k}`,`test-sample-r${k}.recipe.json`,'test-sample',k,'control']));
  assert.deepEqual(compiled.jobs[0].recipe.samples.at(-1),{id:'control',settings:{}});
  assert.notEqual(compiled.jobs[0].recipe,compiled.jobs[1].recipe);
  assert.equal(validateCatalog(input).executionSampleCount,9);
  const many=fixture();many.samples=Array.from({length:21},(_,i)=>({...structuredClone(fixture().samples[0]),id:`s${i}`,repeat:10}));
  assert.throws(()=>compileCatalog(many),/expands to 210 jobs; at most 200/);
  const clash=fixture();Object.assign(clash.samples[0],{id:'control',control:true});assert.throws(()=>compileCatalog(clash),/cannot itself be named control/);
  const tooMany=fixture();tooMany.samples[0].repeat=11;assert.throws(()=>compileCatalog(tooMany),{code:'ERR_SAMPLE_SCHEMA'});
});
test('larger table final states compile to the structured path with sizes, merges and text',()=>{
  const input=tableFixture();Object.assign(input.samples[0].document,{rows:3,columns:3,lineType:1,color:'R0G0B0',
    rowHeights:[2,3,2],columnWidths:[6,4,8],merges:[{from:{row:2,column:2},to:{row:3,column:3}}],
    cells:[{row:2,column:2,text:'結合',attributes:{fill:20}},{row:1,column:1,text:'甲乙'},{row:3,column:1,text:'丙'}]});
  const sample=compileCatalog(input).jobs[0].recipe;
  assert.deepEqual(sample.keisenCanvas,{rows:10,columns:23});
  const ops=sample.samples[0].keisenOperations;
  assert.deepEqual(ops.map(op=>op.type),['table','cellMerge','tableText','tableText','tableText','tableAttribute']);
  assert.deepEqual([ops[0].rows,ops[0].columns],[[2,4,7,9],[3,9,13,21]]);
  assert.deepEqual(ops.slice(2,5).map(op=>op.text),['甲乙','結合','丙']);
  for(const mutate of [
    d=>{delete d.color;},d=>d.columnWidths=[6,4,7],d=>d.rowHeights=[2,2],d=>d.columnWidths=[10,10,4],
    d=>d.merges.push({from:{row:3,column:3},to:{row:3,column:3}}),d=>d.merges.push({from:{row:1,column:2},to:{row:2,column:2}}),
    d=>d.cells.push({row:3,column:3,text:'内'}),d=>d.cells[2].text='甲乙丙',
    d=>d.cells=Array.from({length:9},(_,i)=>({row:1+Math.floor(i/3),column:1+i%3,attributes:{bold:1,italic:1,fill:1}})).filter(c=>!(c.row>1&&c.column>1)||(c.row===2&&c.column===2)),
  ]){const copy=structuredClone(input);mutate(copy.samples[0].document);assert.throws(()=>compileCatalog(copy),{code:'ERR_SAMPLE_SEMANTIC'});}
});
test('typesetting compiles to DocumentStyleRoman values and enforces observed dependencies',()=>{
  const make=typesetting=>{const input=fixture();input.samples[0].feature='document-typesetting';input.samples[0].document={kind:'text',text:'禁則の確認。',typesetting};return input;};
  const features=compileCatalog(make({kinsoku:true,hanging:true,pushIn:false,lineEndForbidden:'「（'})).jobs[0].recipe.samples[0].features;
  assert.deepEqual(features.typesetting,{kinsoku:1,hanging:1,pushIn:0,lineEndForbidden:'「（'});
  for(const t of [{kinsoku:false,hanging:true,pushIn:false},{kinsoku:false,pushIn:true},{hanging:true},{bracketOverlap:false},{bracketOverlap:false,pushIn:true},{lineStartForbidden:'、 。'}])
    assert.throws(()=>compileCatalog(make(t)),{code:'ERR_SAMPLE_SEMANTIC'});
  for(const t of [{},{justification:1},{lineStartForbidden:''},{spreading:true}])
    assert.throws(()=>compileCatalog(make(t)),{code:'ERR_SAMPLE_SCHEMA'});
});
test('typesetting combines with structural paragraphs elements over the shared base',()=>{
  const input=fixture();input.samples[0].feature='document-typesetting';
  input.samples[0].document={kind:'paragraphs',text:'第一段落\n第二段落\n第三段落',headerFooter:{position:'header',text:'見出し'},columns:2,typesetting:{kinsoku:false}};
  const sample=compileCatalog(input).jobs[0].recipe.samples.at(-1);
  assert.deepEqual(sample.features.typesetting,{kinsoku:0});
});
test('the swatch catalog covers every underline, fill and table line type code exactly once',async()=>{
  const catalog=await loadCatalog('examples/agent/36-decoration-swatches.json'),defs=SAMPLE_SCHEMA.$defs;
  const codes=(list,min,max)=>{assert.deepEqual([...list].sort((a,b)=>a-b),Array.from({length:max-min+1},(_,i)=>min+i));};
  const parameters=catalog.samples.flatMap(sample=>sample.document.annotations??[]).map(annotation=>annotation.parameters);
  codes(parameters.filter(p=>p.underline!==undefined).map(p=>p.underline),defs.decoration.properties.underline.minimum,defs.decoration.properties.underline.maximum);
  codes(parameters.filter(p=>p.fill!==undefined).map(p=>p.fill),defs.decoration.properties.fill.minimum,defs.decoration.properties.fill.maximum);
  codes(catalog.samples.filter(sample=>sample.document.kind==='keisen-table').map(sample=>sample.document.lineType),defs.tableDocument.properties.lineType.minimum,defs.tableDocument.properties.lineType.maximum);
  assert.equal(validateCatalog(catalog).sampleCount,31);
});
