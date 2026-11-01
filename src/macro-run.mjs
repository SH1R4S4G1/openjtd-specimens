import { isParagraphDecoration } from './paragraphs.mjs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { expandExperiment, STYLE_FIELDS } from './experiment.mjs';
import { createRun, startSample, appendEvent, saveMacroEvidence, finalizeSample, failSample } from './evidence.mjs';
import { MacroAdapter } from './adapters/macro.mjs';
import { walkedParagraphs } from './ranges.mjs';

export async function runMacroExperiment(recipe,{outputRoot='runs',adapter=new MacroAdapter(),onProgress=()=>{}}={}){
  const plan=expandExperiment(recipe);
  if(plan.samples[0]?.id!=='baseline')throw new Error('Macro experiments require a baseline.');
  const environment=await adapter.connect();
  const run=await createRun({outputRoot,experiment:plan,environment,source:{method:'Documented /M/ command and Sprint macro API; application-generated JTD without binary modification.',adapter:'macro'}});
  const started=Date.now();let baseline=null;let reviewRequiredCount=0;
  for(const spec of plan.samples){
    if(baseline){const bytes=await fs.readFile(baseline.path);if(createHash('sha256').update(bytes).digest('hex')!==baseline.sha256)throw new Error('Baseline changed between samples.');}
    const sample=await startSample(run,{id:spec.id,requested:{...(plan.styleSource?{styleSource:plan.styleSource}:{}),...spec.settings,...(spec.footnote?{footnote:spec.footnote}:{}),...(spec.namedStyle?{namedStyle:spec.namedStyle}:{}),...(spec.headerSteps!==undefined?{headerSteps:spec.headerSteps,headerPages:spec.headerPages,headerPosition:spec.headerPosition}:{}),...(spec.documentColumns!==undefined?{documentColumns:spec.documentColumns}:{}),...(spec.columnRange?{columnRange:spec.columnRange}:{}),...(spec.frames?{frames:spec.frames}:{}),...(spec.headerLayout?{headerLayout:spec.headerLayout}:{}),...(spec.namedStyles?{namedStyles:spec.namedStyles}:{}),...(spec.features?{features:spec.features}:{}),...(spec.layoutPriority?{layoutPriority:spec.layoutPriority}:{}),...(plan.targets?{targets:plan.targets,operations:spec.operations??[]}:{}),...(plan.keisenCanvas?{keisenCanvas:plan.keisenCanvas,keisenOperations:spec.keisenOperations??[]}: {}),...(plan.paragraphTargets?{paragraphTargets:plan.paragraphTargets,paragraphOperations:spec.paragraphOperations??[]}: {})},baseline});
    await onProgress({event:'sample-start',id:spec.id,runDir:run.dir});
    try{
      // Explicit values remain assertions even when equal to the baseline: other
      // settings (including font and margins) can cause coupled layout changes.
      const explicit=recipe.samples?.find(item=>item.id===spec.id)?.settings??{};
      // A styleSource recipe has no defaults, so its baseline requests nothing.
      const fields=spec.id==='baseline'?STYLE_FIELDS.filter(k=>Object.hasOwn(spec.settings,k)):STYLE_FIELDS.filter(k=>spec.changedFields.includes(k)||Object.hasOwn(explicit,k));
      const settings=Object.fromEntries(fields.map(k=>[k,spec.settings[k]]));
      // Range readback walks every character once per stage (about 4.5ms per character on
      // 2026-10-14 hardware); allow 10ms per character and stage, never below the 120s default.
      const stages=plan.targets?(spec.operations?.length??0)+3:0;
      // Long bodies (CR-003): inserting 60000 characters took 15-24s and walking 300
      // paragraphs about 8s per stage on 2026-10-16 hardware.
      // With targets in a long body only the paragraphs holding them are walked, but
      // each is reached by JumpStart+NextParagraph(p), about 14ms per paragraph step.
      const paragraphCount=plan.text.split('\r\n').length;
      const walked=plan.targets?walkedParagraphs(plan.text,plan.targets):[];
      const walkedChars=walked.reduce((n,p)=>n+plan.text.split('\r\n')[p].length,0);
      const jumps=plan.bodyCheck?15*(stages*walked.reduce((n,p)=>n+p,0)+3*(spec.operations?.length??0)*Math.max(0,...walked)):0;
      const bodyWalk=plan.bodyCheck?30000+plan.text.length*2+paragraphCount*60:0;
      const timeoutMs=stages||plan.bodyCheck?Math.min(300000,Math.max(120000,Math.round((stages?20000+walkedChars*stages*10:0)+bodyWalk+jumps))):undefined;
      const result=await adapter.createSample({sample,timeoutMs,styleSource:plan.styleSource,bodyParagraphs:plan.bodyCheck==='paragraph-ends',input:baseline?.path??null,text:plan.text,settings,layoutPriority:spec.layoutPriority??'preserve',features:spec.features??{},captureFeatures:true,targets:plan.targets,operations:spec.operations??[],keisenCanvas:plan.keisenCanvas,keisenOperations:spec.keisenOperations??[],paragraphTargets:plan.paragraphTargets,paragraphOperations:spec.paragraphOperations??[],footnote:spec.footnote,namedStyle:spec.namedStyle,headerSteps:spec.headerSteps,headerPages:spec.headerPages,headerPosition:spec.headerPosition,documentColumns:spec.documentColumns,frames:spec.frames,headerLayout:spec.headerLayout,namedStyles:spec.namedStyles,columnRange:spec.columnRange});
      if(spec.footnote&&!(result.verification?.footnoteProof?.version===(spec.footnote.steps?2:1)&&result.verification.footnoteProof.passed&&result.verification.footnoteProof.reopened&&JSON.stringify(result.verification.footnoteProof.trial)===JSON.stringify(spec.footnote)))throw Object.assign(Error('Footnote requires complete matching proof'),{readbackMismatch:true,details:{differences:result.verification?.differences??null}});
      if(spec.namedStyle&&!(result.verification?.namedStyleProof?.version===1&&result.verification.namedStyleProof.passed&&result.verification.namedStyleProof.reopened&&JSON.stringify(result.verification.namedStyleProof.trial)===JSON.stringify(spec.namedStyle)))throw Object.assign(Error('Named style requires complete matching proof'),{readbackMismatch:true,details:{differences:result.verification?.differences??null}});
      if(spec.headerSteps!==undefined&&!(result.verification?.headerProof?.version===3&&result.verification.headerProof.pages===(spec.headerPages??1)&&result.verification.headerProof.position===(spec.headerPosition??1)&&result.verification.headerProof.passed&&result.verification.headerProof.reopened&&JSON.stringify(result.verification.headerProof.steps)===JSON.stringify(spec.headerSteps)))throw Object.assign(Error('Header trial requires complete matching structural proof'),{readbackMismatch:true,details:{differences:result.verification?.differences??null}});
      if(spec.namedStyles&&!(result.verification?.styleProof?.version===1&&result.verification.styleProof.passed&&result.verification.styleProof.reopened&&JSON.stringify(result.verification.styleProof.trial)===JSON.stringify(spec.namedStyles)))throw Object.assign(Error('Style definitions require complete matching proof'),{readbackMismatch:true,details:{differences:result.verification?.differences??null}});
      if(spec.headerLayout&&!(result.verification?.headerLayoutProof?.version===1&&result.verification.headerLayoutProof.passed&&result.verification.headerLayoutProof.reopened&&JSON.stringify(result.verification.headerLayoutProof.layout)===JSON.stringify(spec.headerLayout)))throw Object.assign(Error('Header layout requires complete matching proof'),{readbackMismatch:true,details:{differences:result.verification?.differences??null}});
      if(spec.frames&&!(result.verification?.frameProof?.version===1&&result.verification.frameProof.passed&&result.verification.frameProof.reopened&&JSON.stringify(result.verification.frameProof.frames)===JSON.stringify(spec.frames)))throw Object.assign(Error('Frame trial requires complete matching proof'),{readbackMismatch:true,details:{differences:result.verification?.differences??null}});
      for(const phase of ['before-save','reopened']){
        const verification=phase==='before-save'?{method:'macro-getter',passed:false,reopened:false}:result.verification;
        await saveMacroEvidence(sample,{label:phase,phase,observed:{...result.observed[phase],...(phase==='reopened'?{body:result.body}:{})},verification,macroSource:result.source,resultBytes:result.resultBytes});
      }
      await appendEvent(run,{type:'macro-completed',sampleId:spec.id,durationMs:result.durationMs,...(result.suspendedMs?{suspendedMs:result.suspendedMs}:{}),launch:result.launch,verification:result.verification});
      const manifest=await finalizeSample(sample,{expectedTitle:sample.documentPath,actualTitle:result.observed.reopened.fullName,verification:result.verification});
      await onProgress({event:'sample-completed',id:spec.id,status:manifest.status,durationMs:result.durationMs,observed:result.observed.reopened.settings,differences:result.verification.differences});
      // Only explicitly getter-less decoration trials may continue as saved.
      // Numeric/text mismatches still stop the batch immediately.
      const pendingReview=manifest.status==='saved'&&manifest.verification.titleMatches===true&&spec.id!=='baseline'&&spec.paragraphOperations?.length>0&&spec.paragraphOperations.every(op=>isParagraphDecoration(op.attribute))&&result.verification.paragraphProof?.reviewRequired===true&&result.verification.reopened===true&&result.verification.bodyMatches===true&&result.verification.differences?.length===0;
      if(pendingReview)reviewRequiredCount++;
      if(manifest.status!=='verified'&&!pendingReview)throw Object.assign(new Error('Sample readback did not match; remaining samples were not run.'),{completed:true,details:result.verification});
      if(spec.id==='baseline')baseline={path:sample.documentPath,sha256:manifest.document.sha256,observed:result.observed.reopened};
    }catch(error){
      // Never let a failure to record the failure hide the original error
      // (for example when the sample had already been finalized).
      if(!error.completed){try{await failSample(sample,error);}catch(recordError){error.recordError=recordError.message;}}
      await appendEvent(run,{type:'macro-run-stopped',sampleId:spec.id,error:String(error.message),details:error.details??null});
      error.runDir=run.dir;throw error;
    }
  }
  const result={runDir:run.dir,reportPath:path.join(run.dir,'index.html'),sampleCount:plan.samples.length,reviewRequiredCount,durationMs:Date.now()-started};
  await appendEvent(run,{type:'macro-run-completed',...result});return result;
}

