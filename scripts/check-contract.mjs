import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCapabilities } from './generate-capabilities.mjs';
import { validateCatalog } from '../src/sample-catalog.mjs';
import { isPdfCatalog, validatePdfCatalog } from '../src/pdf-catalog.mjs';
import { buildCapabilities, REQUEST_BINDINGS } from '../src/sample-capabilities.mjs';
import { SAMPLE_SCHEMA } from '../src/sample-schema.mjs';
import { checkPublicDefinitions } from '../src/capability-documentation.mjs';
import { checkSourceReferences } from '../src/evidence-references.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function checkContract() {
  await checkCapabilities();
  checkPublicDefinitions();
  const declared=SAMPLE_SCHEMA.$defs.sample.properties.feature.enum;
  const bound=Object.keys(REQUEST_BINDINGS);
  if (JSON.stringify([...declared].sort())!==JSON.stringify([...bound].sort())) throw new Error('Schema feature enum and compiler bindings disagree.');
  for (const capability of buildCapabilities().capabilities) {
    const reference=capability.parametersSchema ?? capability.parametersReference;
    const [filename,fragment]=reference.split('#');
    await fs.access(path.join(root,filename));
    if (fragment && !SAMPLE_SCHEMA.$defs[fragment.split('/').at(-1)]) throw new Error(`Missing schema definition: ${reference}`);
  }
  const covered = new Set();
  for (const file of (await fs.readdir(path.join(root,'examples/agent'))).filter(name=>name.endsWith('.json'))) {
    const example=JSON.parse(await fs.readFile(path.join(root,'examples/agent',file),'utf8'));
    const result=isPdfCatalog(example)?validatePdfCatalog(example):validateCatalog(example);
    for (const id of result.capabilities) covered.add(id);
  }
  for (const capability of buildCapabilities().capabilities) if (capability.requestSupported && !covered.has(capability.id)) throw new Error(`Missing canonical example for ${capability.id}`);
  // Complete request examples in prose must obey the same contract. Other
  // JSON snippets (legacy recipes and intentionally invalid fragments) are
  // outside this check and remain explicitly labelled in their documents.
  for (const block of (await fs.readFile(path.join(root,'docs/sample-request-spec.md'),'utf8')).matchAll(/```json\r?\n([\s\S]*?)```/g)) {
    const example=JSON.parse(block[1]);
    if (example.schemaVersion === 1 && example.id && example.samples) validateCatalog(example);
  }
  // Links into experiment storage are only classified here; their existence and
  // run integrity belong to the separate evidence gate (scripts/check-evidence.mjs).
  return checkSourceReferences(root);
}
