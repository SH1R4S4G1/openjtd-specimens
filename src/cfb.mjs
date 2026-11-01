// Read-only CFB container reader. Public MS-CFB structure, no JTD semantics.
const END=0xfffffffe, FREE=0xffffffff;
export const CFB_SIGNATURE=Buffer.from('d0cf11e0a1b11ae1','hex');
const check=(ok,message)=>{if(!ok)throw new Error('CFB: '+message);};
export function readCfb(bytes) {
  if(!bytes.subarray(0,8).equals(CFB_SIGNATURE))return null;
  check(bytes.length>=512,'truncated header');
  const u32=o=>bytes.readUInt32LE(o), version=bytes.readUInt16LE(26), shift=bytes.readUInt16LE(30);
  check((version===3&&shift===9)||(version===4&&shift===12),'unsupported sector geometry');
  check(bytes.readUInt16LE(28)===0xfffe&&bytes.readUInt16LE(32)===6&&u32(56)===4096,'invalid header');
  const sectorSize=2**shift, count=bytes.length/sectorSize-1;
  check(Number.isInteger(count)&&count>=2,'truncated sectors');
  const sector=id=>{check(Number.isInteger(id)&&id>=0&&id<count,'sector out of bounds');return bytes.subarray((id+1)*sectorSize,(id+2)*sectorSize);};
  const words=b=>Array.from({length:b.length/4},(_,i)=>b.readUInt32LE(i*4));
  const fatIds=words(bytes.subarray(76,512)).filter(id=>id!==FREE), difSeen=new Set();
  let dif=u32(68);
  check(u32(72)<=count&&u32(44)<=count,'oversized FAT');
  for(let n=0;n<u32(72);n++){
    check(!difSeen.has(dif),'cyclic DIFAT');difSeen.add(dif);
    const entries=words(sector(dif));dif=entries.pop();fatIds.push(...entries.filter(id=>id!==FREE));
  }
  check((u32(72)===0||dif===END)&&fatIds.length===u32(44)&&new Set(fatIds).size===fatIds.length,'invalid DIFAT');
  const fat=fatIds.flatMap(id=>words(sector(id)));
  const used=new Set([...fatIds,...difSeen]), miniUsed=new Set();
  const chain=(start,table,limit,claimed)=>{
    const ids=[],seen=new Set();let id=start;
    while(id!==END){
      check(Number.isInteger(id)&&id>=0&&id<limit&&id<table.length,'invalid chain index');
      check(!seen.has(id)&&!claimed.has(id),'cyclic or overlapping chain');seen.add(id);claimed.add(id);ids.push(id);id=table[id];
    }
    return ids;
  };
  const normal=(start,size)=>{
    if(size===0){check(start===END||start===FREE,'nonempty zero-size chain');return {bytes:Buffer.alloc(0),spans:[]};}
    const ids=chain(start,fat,count,used), length=size??ids.length*sectorSize;
    check(Number.isSafeInteger(length)&&length>=0&&Math.ceil(length/sectorSize)===ids.length,'chain/size mismatch');
    const spans=ids.map((id,i)=>({offset:i*sectorSize,fileOffset:(id+1)*sectorSize,length:Math.min(sectorSize,length-i*sectorSize)}));
    return {bytes:Buffer.concat(ids.map(sector)).subarray(0,length),spans};
  };
  const directory=normal(u32(48));
  const entries=[];
  for(let o=0;o<directory.bytes.length;o+=128){
    const b=directory.bytes.subarray(o,o+128),type=b[66];
    if(type===0){entries.push(null);continue;}
    const n=b.readUInt16LE(64);check([1,2,5].includes(type)&&n>=2&&n<=64&&n%2===0&&b.readUInt16LE(n-2)===0,'invalid directory entry');
    const size=version===3?b.readUInt32LE(120):Number(b.readBigUInt64LE(120));
    check(Number.isSafeInteger(size)&&size<=bytes.length,'invalid stream size');
    entries.push({name:b.subarray(0,n-2).toString('utf16le'),type,left:b.readUInt32LE(68),right:b.readUInt32LE(72),child:b.readUInt32LE(76),start:b.readUInt32LE(116),size});
  }
  check(entries[0]?.type===5,'missing root entry');
  const miniFat=words(normal(u32(60),u32(64)*sectorSize).bytes), root=normal(entries[0].start,entries[0].size);
  const streams=new Map(), visited=new Set([0]), stack=[{id:entries[0].child,path:[]}];
  while(stack.length){
    const {id,path}=stack.pop();if(id===FREE)continue;
    check(id<entries.length&&entries[id]&&!visited.has(id),'invalid directory tree');visited.add(id);
    const e=entries[id],segments=[...path,e.name],key=JSON.stringify(segments);
    stack.push({id:e.left,path},{id:e.right,path});
    if(e.type===1){stack.push({id:e.child,path:segments});continue;}
    check(e.type===2&&e.child===FREE&&!streams.has(key),'invalid stream entry');
    let data;
    if(e.size>=4096)data=normal(e.start,e.size);
    else if(e.size===0)data={bytes:Buffer.alloc(0),spans:[]};
    else{
      const ids=chain(e.start,miniFat,Math.ceil(root.bytes.length/64),miniUsed);
      check(ids.length===Math.ceil(e.size/64),'mini chain/size mismatch');
      const spans=ids.map((mini,i)=>{
        const offset=mini*64,length=Math.min(64,e.size-i*64),span=root.spans[Math.floor(offset/sectorSize)];
        check(span&&offset+length<=root.bytes.length,'mini stream out of bounds');
        return {offset:i*64,fileOffset:span.fileOffset+offset%sectorSize,length};
      });
      data={bytes:Buffer.concat(spans.map(s=>bytes.subarray(s.fileOffset,s.fileOffset+s.length))),spans};
    }
    streams.set(key,{key,path:segments,...data});
  }
  check(entries.every((e,i)=>!e||visited.has(i)),'unreachable directory entries');
  return {version,sectorSize,streams};
}

/** Map a logical stream byte interval back to exact physical file spans. */
export function physicalSpans(stream,offset,length){
  return stream.spans.flatMap(s=>{
    const start=Math.max(offset,s.offset),end=Math.min(offset+length,s.offset+s.length);
    return end>start?[{offset:start,fileOffset:s.fileOffset+start-s.offset,length:end-start}]:[];
  });
}
