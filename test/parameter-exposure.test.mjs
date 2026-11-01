import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildParameterExposure, internalParameterInventory, PARAMETER_EXPOSURE, checkPublicParameterCoverage } from '../src/parameter-exposure.mjs';
import { SAMPLE_SCHEMA } from '../src/sample-schema.mjs';
import { REQUEST_BINDINGS } from '../src/sample-capabilities.mjs';
import { compileCatalog } from '../src/sample-catalog.mjs';
import { expandExperiment } from '../src/experiment.mjs';

test('ruby public alignments map to verified internal evenly/position combinations; omission delegates to Ichitaro',async()=>{
  const catalog=JSON.parse(await readFile('examples/agent/08-ruby-alignment.json','utf8'));
  const combinations=[[0,1],[0,2],[0,3],[1,1]];
  const compiled=compileCatalog(catalog);
  compiled.jobs.forEach((job,i)=>{
    const op=expandExperiment(job.recipe).samples[1].operations[0];
    assert.deepEqual([op.evenly,op.position],combinations[i]);
    assert.equal(op.placement,null);
  });
  delete catalog.samples[0].document.annotations[0].parameters.alignment;
  const recipe=compileCatalog(catalog).jobs[0].recipe;
  assert.equal(recipe.samples[0].operations[0].evenly,null);
  const op=expandExperiment(recipe).samples[1].operations[0];
  assert.deepEqual([op.evenly,op.position],[null,null]);
  for(const parameters of [{alignment:'justify'},{alignment:1},{evenly:0},{position:2}]){
    Object.assign(catalog.samples[0].document.annotations[0],{parameters:{reading:'よみ',...parameters}});
    assert.throws(()=>compileCatalog(catalog),{code:'ERR_SAMPLE_SCHEMA'});
  }
});

test('each internal parameter has an explicit public, fixed or internal-only decision',()=>{
  const exposure=buildParameterExposure();
  assert.equal(exposure.parameters.length,Object.values(internalParameterInventory()).flat().length);
  for(const field of ['evenly','position']){
    const row=exposure.parameters.find(p=>p.capability==='ruby'&&p.parameter===field);
    assert.equal(row.status,'public');assert.equal(row.field,'alignment');
  }
  assert.equal(exposure.parameters.find(p=>p.capability==='document-font'&&p.parameter==='westernName').status,'internal-only');
  assert.equal(exposure.parameters.find(p=>p.capability==='ruby'&&p.parameter==='mode').status,'fixed');
  checkPublicParameterCoverage(REQUEST_BINDINGS);
});

test('added or removed internal fields cannot silently escape publication review',()=>{
  for(const capability of ['ruby','document-font','keisen-table']) {
    const inventory=internalParameterInventory();inventory[capability].push('new-parameter');
    assert.throws(()=>buildParameterExposure({inventory}),/Unclassified/);
    inventory[capability].splice(0,2);
    assert.throws(()=>buildParameterExposure({inventory}),/Unclassified/);
  }
  const policy=structuredClone(PARAMETER_EXPOSURE);delete policy.ruby.position;
  assert.throws(()=>buildParameterExposure({policy}),/Unclassified/);
});

test('public mapping requires real schema fields and explicit reasons for unpublished parameters',()=>{
  const policy=structuredClone(PARAMETER_EXPOSURE);policy.ruby.position.field='missing';
  assert.throws(()=>buildParameterExposure({policy}),/Missing public parameter/);
  policy.ruby.position= {status:'internal-only',note:''};
  assert.throws(()=>buildParameterExposure({policy}),/Invalid parameter exposure/);
  const schema=structuredClone(SAMPLE_SCHEMA);schema.$defs.ruby.properties.font={type:'string'};
  // 'font' is a parameter here, not a text-document container.
  assert.throws(()=>checkPublicParameterCoverage(REQUEST_BINDINGS,schema),/no internal mapping/);
});
