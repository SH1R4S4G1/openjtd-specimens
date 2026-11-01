import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkContract} from './check-contract.mjs';
async function check(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){const filename=path.join(dir,item.name);if(item.isDirectory())await check(filename);else if(filename.endsWith('.mjs')){const result=spawnSync(process.execPath,['--check',filename],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);}}}
for(const dir of ['bin','src','scripts'])await check(dir);
console.log('Syntax checks passed.');
await checkContract();
console.log('Sample contract, canonical examples, capability freshness and source documentation links passed.');
console.log('Experiment storage evidence is not checked here; run npm run check:evidence where runs are available.');
