#!/usr/bin/env node
// Run an Execution Recipe (the internal format) with the macro adapter.
//
//   node bin/ichitaro-macro.mjs <recipe.json> [output-root] [--exe <taro36.exe>] [--allow-running-ichitaro]
import * as fs from 'node:fs/promises';
import { MacroAdapter } from '../src/adapters/macro.mjs';
import { runMacroExperiment } from '../src/macro-run.mjs';
import { takeIchitaroOptions, ICHITARO_OPTIONS_USAGE } from '../src/ichitaro-options.mjs';
try{
  const options=takeIchitaroOptions(process.argv.slice(2));
  const [recipePath,outputRoot='runs',...extra]=options.args;
  if(!recipePath||extra.length)throw new Error(`Usage: node bin/ichitaro-macro.mjs <recipe.json> [output-root] ${ICHITARO_OPTIONS_USAGE}`);
  const recipe=JSON.parse((await fs.readFile(recipePath,'utf8')).replace(/^\uFEFF/,''));
  const adapter=new MacroAdapter({exe:options.exe,allowRunning:options.allowRunning});
  const result=await runMacroExperiment(recipe,{outputRoot,adapter,onProgress:event=>process.stderr.write(JSON.stringify(event)+'\n')});
  process.stdout.write(JSON.stringify({ok:true,...result},null,2)+'\n');
}catch(error){process.stderr.write(JSON.stringify({ok:false,error:error.message,code:error.code,details:error.details,runDir:error.runDir},null,2)+'\n');process.exitCode=1;}
