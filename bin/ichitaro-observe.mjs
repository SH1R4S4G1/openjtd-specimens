#!/usr/bin/env node
import { observeRun, observePair, inspectBytes } from '../src/observation.mjs';
try{
  const [command,target,...args]=process.argv.slice(2);
  let result;
  if(command==='run'&&target&&args.length<=2)result=await observeRun(target,{outputDirectory:args[0],referenceId:args[1]});
  else if(command==='pair'&&target&&args.length===2)result=await observePair(target,args[0],args[1]);
  else if(command==='slice'&&target&&args.length>=2&&args.length<=3){
    if(!/^(?:0x[0-9a-f]+|\d+)$/i.test(args[0])||!/^\d+$/.test(args[1]))throw new Error('Invalid offset or length.');
    const stream=args[2]?JSON.parse(args[2]):undefined;
    if(stream&&(!Array.isArray(stream)||!stream.every(s=>typeof s==='string')))throw new Error('Stream must be a JSON string array.');
    result=await inspectBytes(target,{offset:Number(args[0]),length:Number(args[1]),stream});
  }else throw new Error('Usage: ichitaro-observe.mjs run <run-dir> [new-output-dir] [reference-id] | pair <before.jtd> <after.jtd> <new-output-dir> | slice <file.jtd> <offset decimal/hex> <length 1..4096> [stream-path JSON array]');
  console.log(JSON.stringify(result,null,2));
}catch(error){console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
