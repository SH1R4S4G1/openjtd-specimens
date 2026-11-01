#!/usr/bin/env node
import { writeMacroCatalog } from '../src/macro-catalog.mjs';
try{
  const [output,...args]=process.argv.slice(2),options={runDirectories:[]};
  if(!output||args.length%2)throw new Error('Usage: ichitaro-catalog.mjs <new-output-dir> [--help-dir <CHM-html-dir>] [--run <run-dir>]...');
  for(let i=0;i<args.length;i+=2){if(args[i]==='--help-dir')options.helpDirectory=args[i+1];else if(args[i]==='--run')options.runDirectories.push(args[i+1]);else throw new Error('Unknown option: '+args[i]);}
  console.log(JSON.stringify(await writeMacroCatalog(output,options),null,2));
}catch(error){console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
