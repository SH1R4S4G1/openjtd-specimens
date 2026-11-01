// Public help: Columns t26m9otv, CancelColumns t26m48hf, GetColumns t26m3d2r.
export const DOCUMENT_COLUMNS_FIELDS=['documentColumns','columnRange'];
// Partial range (probe tmp/probe-columns-range-v2.mjs): Columns(n) at the start of
// the first paragraph opens a section to the document end; CancelColumns() at the
// start of the next paragraph closes it. A selected range is not used.
export function validateColumnRange(range,steps,text){
 if(range===undefined)return undefined;const p=columnParagraphs(text);
 if(!range||Object.getPrototypeOf(range)!==Object.prototype||Object.keys(range).some(k=>!['from','to'].includes(k))||!Number.isInteger(range.from)||!Number.isInteger(range.to)||range.from<0||range.to<range.from||range.to>=p.length||(range.from===0&&range.to===p.length-1))throw Error('Column range needs zero-based from<=to inside the text and must not cover the whole document');
 if(!Array.isArray(steps)||steps.length!==1||![2,3].includes(steps[0]))throw Error('A column range takes exactly one step of 2 or 3 columns');
 return {from:range.from,to:range.to};
}
export const COLUMN_BASE_FEATURES={font:{japaneseName:'游明朝',japaneseStyle:'標準',westernName:10,digitFont:11,size:10.5,sizeUnit:3,scaleX:100,scaleY:100},paper:{name:'A4 単票・縦方向'},layout:{orientation:1}};
export function columnParagraphs(text){const p=text.replace(/\r\n|\r/g,'\n').split('\n');if(p.length<3||p.length>8||text.length>2048||p.some(s=>!s.length||s.length>1024||/[\s\x00-\x1f\x7f\uD800-\uDFFF\p{M}]/u.test(s)))throw Error('Document columns require 3..8 nonempty BMP paragraphs without whitespace, max 2048 characters');return p;}
export function validateDocumentColumns(steps,text){columnParagraphs(text);if(!Array.isArray(steps)||steps.length>8||steps.some(n=>![1,2,3].includes(n)))throw Error('Document columns: at most 8 steps, each 1, 2 or 3');return [...steps];}
export function columnsMacro({text,steps,q,range}){
 steps=validateDocumentColumns(steps,text);const paragraphs=columnParagraphs(text);range=validateColumnRange(range,steps,text);
 const at=n=>['CancelMode()','CancelAllRange()','JumpStart()',...(n?['NextParagraph('+n+')']:[])];
 function snapshot(stage){const out=[];for(const [p,line] of paragraphs.entries()){out.push(...at(p));for(let k=0;k<line.length;k++){const key='columns.'+stage+'.'+p+'.'+k;out.push('%result.LinePrint('+q(key+'.char=')+' & GetCharacter())','%result.LinePrint('+q(key+'.count=')+' & GetColumns())','CursorRight(1)');}out.push(...at(p),'RangeMode(3)','RangeStart()','RangeEnd(1,1)','%ct=GetString(1)','%cn=0','foreach %cv in %ct','%cn=%cn+1','%result.LinePrint('+q('columns.'+stage+'.'+p+'.text.')+' & %cn & "=" & %cv)','next','%result.LinePrint('+q('columns.'+stage+'.'+p+'.lines=')+' & %cn)');}out.push('CancelAllRange()');return out;}
 if(range){const apply=[...snapshot('initial'),...at(range.from),'Columns('+steps[0]+')',...(range.to<paragraphs.length-1?[...at(range.to+1),'CancelColumns()']:[]),...snapshot('step-0')];return {apply,snapshot};}
 const apply=snapshot('initial');let current=1;for(const [i,count] of steps.entries()){apply.push(...at(0),'SelectAll(1)');if(current!==1){apply.push('CancelColumns()',...snapshot('cleared-'+i),...at(0),'SelectAll(1)');}if(count!==1)apply.push('Columns('+count+')');apply.push(...snapshot('step-'+i));current=count;}return {apply,snapshot};
}
// ignoreSpaces: a frame makes GetString show an extra body space; characters are
// still compared one by one, and column paragraphs never contain whitespace.
export function verifyColumns(meta,{text,steps,ignoreSpaces=false,range}){
 steps=validateDocumentColumns(steps,text);range=validateColumnRange(range,steps,text);const paragraphs=columnParagraphs(text),stages=[['initial',1]],differences=[],snapshots={};let current=1;
 // With a range, paragraphs outside it stay one column at every stage.
 const expectedCount=(stage,p,count)=>range&&stage!=='initial'&&(p<range.from||p>range.to)?1:count;
 for(const [i,n] of steps.entries()){if(current!==1)stages.push(['cleared-'+i,1]);stages.push(['step-'+i,n]);current=n;}stages.push(['before-save',current],['reopened',current]);
 for(const [stage,count] of stages){const observed=[];for(const [p,line] of paragraphs.entries()){const base='columns.'+stage+'.'+p;let characters='';const counts=[];for(let k=0;k<line.length;k++){const key=base+'.'+k,character=meta[key+'.char'],raw=meta[key+'.count'];if(typeof character!=='string'||!/^\d+$/.test(raw??''))throw Error('Missing column character/getter: '+key);characters+=character;counts.push(Number(raw));}const length=Number(meta[base+'.lines']);if(!Number.isInteger(length)||length<1||length>2048)throw Error('Missing column paragraph text');let selected='';for(let n=1;n<=length;n++){const s=meta[base+'.text.'+n];if(typeof s!=='string')throw Error('Missing selected paragraph line');selected+=s;}if(characters!==line||(ignoreSpaces?selected.replaceAll(' ',''):selected)!==line||counts.some(n=>n!==expectedCount(stage,p,count)))differences.push({phase:stage,paragraph:p+1,expected:{text:line,columns:expectedCount(stage,p,count)},actual:{characters,selected,counts}});observed.push({text:characters,columns:counts});}snapshots[stage]=observed;}
 return {snapshots,differences,proof:{version:1,passed:!differences.length,reopened:!differences.some(d=>d.phase==='reopened'),steps,...(range?{range}:{}),checks:[],scope:'Each character in each logical paragraph and its GetColumns value; replacement first checks return to one column',limitations:['Only whole-document horizontal 1/2/3-column trials; no nested sections','Physical coordinates, pagination, headers and inherited styles are not verified','GetString physical wrapping and empty structural lines are joined only alongside independent per-character checks']}};
}
