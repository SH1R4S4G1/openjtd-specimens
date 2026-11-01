import test from 'node:test';
import os from 'node:os';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { indexMacroHelp, buildMacroCatalog } from '../src/macro-catalog.mjs';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ichitaro-catalog-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('catalog merges title aliases and duplicate pages, keeping dialog variants separate',async t=>{
  const dir=await fixture(t);
  for(const [file,title] of [['one','CharacterAttribute/alias'],['two','CharacterAttribute'],['three','CharacterAttribute?/dialog'],['four','Generic page']])await fs.writeFile(path.join(dir,file+'.htm'),`<title>${title}</title><p>reference</p>`);
  const entries=await indexMacroHelp(dir);assert.equal(entries.length,2);assert.equal(entries[0].sources.length,2);assert.deepEqual(entries[0].aliases,['alias']);assert.equal(entries[1].classification,'dialog');
});
test('catalog never promotes implementation to runtime without valid evidence',async t=>{
  const dir=await fixture(t);await fs.writeFile(path.join(dir,'reference.htm'),'<title>CharacterSpace</title>');
  const result=await buildMacroCatalog({helpDirectory:dir,runDirectories:[path.join(dir,'missing-run')]});
  assert.equal(result.summary.stages.implemented,27);assert.equal(result.summary.stages.runtimeApplied,0);assert.equal(result.summary.stages.reopenedVerified,0);assert.equal(result.rejectedRuns.length,1);
  assert.notEqual(result.capabilities.find(c=>c.id==='character-border').id,result.capabilities.find(c=>c.id==='body-keisen').id);
});
