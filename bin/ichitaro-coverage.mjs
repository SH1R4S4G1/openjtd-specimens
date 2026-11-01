#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { generateCoverage } from '../src/coverage.mjs';
try {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw new Error('Usage: node bin/ichitaro-coverage.mjs spec.json recipe.json');
  const recipe=generateCoverage(JSON.parse((await readFile(input,'utf8')).replace(/^\uFEFF/,'')));
  await writeFile(output, JSON.stringify(recipe,null,2)+'\n', {flag:'wx'});
  console.log(JSON.stringify({recipe:output,sampleCount:recipe.samples.length+1}));
} catch(error) { console.error(JSON.stringify({ok:false,error:error.message})); process.exitCode=1; }
