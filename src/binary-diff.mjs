import { createHash } from 'node:crypto';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const hexOffset=n=>'0x'+n.toString(16).padStart(8,'0');
/** Positional comparison, deliberately no guessed insertion/deletion alignment. */
export function diffBytes(before,after,{maxRanges=4096,previewBytes=32}={}){
  if(!Number.isInteger(maxRanges)||maxRanges<1||maxRanges>100000||!Number.isInteger(previewBytes)||previewBytes<1||previewBytes>256)throw new Error('Invalid diff limits.');
  let changedBytes=0,rangeCount=0,start=null;const ranges=[];
  const finish=end=>{
    if(start===null)return;
    rangeCount++;
    if(ranges.length<maxRanges){
      const a=before.subarray(start,end),b=after.subarray(start,end);
      ranges.push({offset:start,offsetHex:hexOffset(start),length:end-start,beforeLength:a.length,afterLength:b.length,
        beforeHex:a.subarray(0,previewBytes).toString('hex'),afterHex:b.subarray(0,previewBytes).toString('hex'),
        previewTruncated:Math.max(a.length,b.length)>previewBytes,beforeSha256:digest(a),afterSha256:digest(b)});
    }
    start=null;
  };
  for(let i=0;i<Math.max(before.length,after.length);i++){
    if(before[i]!==after[i]){changedBytes++;start??=i;}else finish(i);
  }
  finish(Math.max(before.length,after.length));
  return {beforeBytes:before.length,afterBytes:after.length,sizeDelta:after.length-before.length,changedBytes,rangeCount,omittedRanges:rangeCount-ranges.length,
    alignment:'same-offset; length changes may shift subsequent content',ranges};
}
