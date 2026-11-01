import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { buildCapabilities } from '../src/sample-capabilities.mjs';
import { renderCapabilityDocumentation } from '../src/capability-documentation.mjs';
import { buildParameterExposure, renderParameterExposure, checkPublicParameterCoverage } from '../src/parameter-exposure.mjs';
import { REQUEST_BINDINGS } from '../src/sample-capabilities.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export function capabilityArtifacts() {
  const catalog=buildCapabilities();
  checkPublicParameterCoverage(REQUEST_BINDINGS);
  const exposure=buildParameterExposure();
  return {'capabilities.json':JSON.stringify(catalog,null,2)+'\n',
    'docs/generated/sample-capabilities.md':renderCapabilityDocumentation(catalog),
    'parameter-exposure.json':JSON.stringify(exposure,null,2)+'\n',
    'docs/generated/parameter-exposure.md':renderParameterExposure(exposure)};
}
export async function checkCapabilities(directory=root) {
  for (const [filename,expected] of Object.entries(capabilityArtifacts())) {
    let actual;
    try { actual=await readFile(path.join(directory,filename),'utf8'); }
    catch (error) { if(error.code!=='ENOENT')throw error; }
    if(actual!==expected)throw new Error(`${filename} is missing or stale. Run node scripts/generate-capabilities.mjs.`);
  }
}
export async function generateCapabilities(directory=root) {
  const artifacts=capabilityArtifacts();
  for (const [filename,contents] of Object.entries(artifacts)) {
    await mkdir(path.dirname(path.join(directory,filename)),{recursive:true});
    await writeFile(path.join(directory,filename),contents);
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await generateCapabilities();
}
