import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { SAMPLE_SCHEMA } from '../src/sample-schema.mjs';
import { buildCapabilities, REQUEST_BINDINGS } from '../src/sample-capabilities.mjs';
import { checkPublicDefinitions, renderCapabilityDocumentation, schemaRoutes, schemaTable } from '../src/capability-documentation.mjs';
import { capabilityArtifacts, generateCapabilities, checkCapabilities } from '../scripts/generate-capabilities.mjs';

test('parameter documentation derives kinds, paths, branches and constraints from Schema',()=>{
  assert.deepEqual(schemaRoutes('ruby'),[{location:'document.annotations[].parameters',kind:'text',selectors:{capability:'ruby'}}]);
  assert.equal(schemaRoutes('tableDocument')[0].kind,'keisen-table');
  assert.equal(schemaRoutes('font')[0].location,'document.font');
  const table=schemaTable(SAMPLE_SCHEMA.$defs.spacing);
  assert.match(table,/oneOf 1: unit="mm"/);assert.match(table,/oneOf 2: unit="percent"/);
  assert.match(table,/minimum=-176.4/);assert.match(table,/maximum=200/);
  const ruby=schemaTable(SAMPLE_SCHEMA.$defs.ruby);
  assert.match(ruby,/reading<\/code> \| string \| 必須/);
  assert.match(ruby,/placement<\/code> \| string \| 任意/);
  assert.match(ruby,/"above"/);assert.match(ruby,/maxLength=64/);
});

test('schema changes appear in generated Markdown without a renderer edit',()=>{
  const schema=structuredClone(SAMPLE_SCHEMA);
  schema.$defs.font.properties.sizePt.maximum=42;
  schema.$defs.font.properties.family={type:'string',enum:['a','b']};
  const output=renderCapabilityDocumentation(buildCapabilities(),schema);
  assert.match(output,/maximum=42/);assert.match(output,/family<\/code>/);assert.match(output,/"b"/);
  assert.notEqual(output,renderCapabilityDocumentation());
});

test('unpublished capabilities stay visibly distinct and Markdown values are escaped',()=>{
  const catalog=buildCapabilities();catalog.capabilities[0].description='a|<b>\n`x`';
  const output=renderCapabilityDocumentation(catalog);
  assert.match(output,/a&#124;&lt;b&gt;<br>&#96;x&#96;/);
  assert.match(output,/keisen-table-topology<\/code>.*implemented.*false.*外部API未公開/);
  assert.match(output,/paragraph-decoration<\/code>.*implemented.*false/);
  assert.match(output,/paragraph-decoration<\/code>.*implemented.*false/);
});

test('public definition check rejects missing, unreachable and mismatched schemas in both directions',()=>{
  const mutations=[
    s=>delete s.$defs.ruby,
    s=>s.$defs.sample.properties.feature.enum.push('invented'),
    s=>s.$defs.annotation.oneOf.find(b=>b.properties.capability.const==='ruby').properties.capability.const='invented',
    s=>s.$defs.annotation.oneOf.find(b=>b.properties.capability.const==='ruby').properties.parameters.$ref='#/$defs/font',
    s=>s.$defs.annotation.oneOf=s.$defs.annotation.oneOf.filter(b=>b.properties.capability.const!=='ruby'),
  ];
  for(const mutate of mutations){const schema=structuredClone(SAMPLE_SCHEMA);mutate(schema);assert.throws(()=>checkPublicDefinitions(schema));}
  const catalog=buildCapabilities();catalog.capabilities.find(c=>c.id==='ruby').status='unimplemented';
  assert.throws(()=>checkPublicDefinitions(SAMPLE_SCHEMA,REQUEST_BINDINGS,catalog),/not implemented/);
});

test('generation is deterministic and freshness check rejects missing or edited artifacts',async t=>{
  const dir=await fs.mkdtemp(path.join(tmpdir(),'capability-docs-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await assert.rejects(checkCapabilities(dir),/missing or stale/);
  await generateCapabilities(dir);await checkCapabilities(dir);
  const expected=capabilityArtifacts();await generateCapabilities(dir);
  for(const [filename,contents] of Object.entries(expected)) {
    const file=path.join(dir,filename);assert.equal(await fs.readFile(file,'utf8'),contents);
    await fs.appendFile(file,'stale');await assert.rejects(checkCapabilities(dir),/missing or stale/);
    await generateCapabilities(dir);
    await fs.unlink(file);await assert.rejects(checkCapabilities(dir),/missing or stale/);
    await generateCapabilities(dir);
  }
  await checkCapabilities(dir);
});
