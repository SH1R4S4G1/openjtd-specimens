import { validateHeaderPages, headerPageSnapshot, verifyHeaderPages } from './header-pages.mjs';
// Public APIs: HeaderFooterEach t26m85k8, GetHeaderFooterEach t26m6pt4,
// JumpHeaderFooter t26m49f6, GetCursorArea t26m5rxd, GetPosition t26m9j1q.
export const HEADER_FIELDS=['headerSteps','headerPosition','headerPages'];
const EACH=['付ける','ﾏｰｼﾞﾝ','ﾏｰｼﾞﾝ設定単位','文字列1','文字列2','文字列3'];
const GLOBAL=['振り分け','奇数偶数で別','和文ﾌｫﾝﾄ名','和文ｽﾀｲﾙ名','欧文ﾌｫﾝﾄ名','欧文ｽﾀｲﾙ名','数字ﾌｫﾝﾄ','文字ｻｲｽﾞ設定','文字ｻｲｽﾞ','文字ｻｲｽﾞ単位','拡大率設定','縦拡大率','横拡大率'];
export function validateHeaderSteps(steps,text){
 const short=s=>typeof s==='string'&&s.length<=24&&!/[\s\x00-\x1f\x7f\uD800-\uDFFF\p{M}]/u.test(s);
 const paragraphs=text.replace(/\r\n|\r/g,'\n').split('\n');
 if(paragraphs.length!==3||paragraphs.some(s=>!s||!short(s)))throw Error('Header trial requires three short nonempty BMP paragraphs without whitespace');
 if(!Array.isArray(steps)||steps.length>8||Array.from(steps).some(s=>!short(s)))throw Error('Header steps require at most eight short BMP strings; empty string clears');
 return [...steps];
}
export function validateHeaderPosition(position=1){if(![1,2].includes(position))throw Error('Header position must be 1 (upper) or 2 (lower)');return position;}
export function headerMacro({text,steps,q,position=1,pages=1}){
 pages=validateHeaderPages(pages);position=validateHeaderPosition(position);steps=validateHeaderSteps(steps,text);
 const emit=(key,value)=>'%result.LinePrint('+q(key+'=')+' & '+value+')';
 const set=s=>['CancelAllRange()','JumpStart()',`HeaderFooterEach(${position},${s?1:0},20,1,${q(s)},"","")`,'SetHeaderFooter()'];
 function snapshot(stage,value=steps.at(-1)??''){
  const out=['CancelAllRange()'];const base='header.'+stage+'.';
  for(let p=1;p<=4;p++){out.push('%hh=GetHeaderFooterEach('+p+')');for(const key of EACH)out.push(emit(base+p+'.'+key,'%hh('+q(key)+')'));}
  out.push('%hh=GetHeaderFooterArrangement()');for(const key of GLOBAL)out.push(emit(base+'global.'+key,'%hh('+q(key)+')'));
  if(value){out.push('ViewImageMarginArea(1)','ViewPrintImageMarginArea(1)','JumpHeaderFooter('+position+',1)',emit(base+'area','GetCursorArea()'),'%hp=GetPosition(1)',emit(base+'page','%hp('+q('ページ番号')+')'),emit(base+'x','%hp('+q('X方向位置')+')'),emit(base+'y','%hp('+q('Y方向位置')+')'),'SelectAll(1)','%hs=GetString(1)','%hn=0','foreach %hv in %hs','%hn=%hn+1','%result.LinePrint('+q(base+'text.')+' & %hn & "=" & %hv)','next',emit(base+'lines','%hn'),'CancelAllRange()','JumpHeaderFooter(5,1)');}
  out.push('JumpStart()',emit(base+'bodyArea','GetCursorArea()'),'SelectAll(1)','%hs=GetString(1)','%hn=0','foreach %hv in %hs','%hn=%hn+1','%result.LinePrint('+q(base+'body.')+' & %hn & "=" & %hv)','next',emit(base+'bodyLines','%hn'),'CancelAllRange()','JumpStart()');if(pages===3)out.push(...headerPageSnapshot({text,value,position,stage,q}));return out;
 }
 const apply=['HeaderFooterArrangement(0,0)','SetHeaderFooter()',...set(''),...snapshot('initial','')];
 for(const [i,value] of steps.entries())apply.push(...set(value),...snapshot('step-'+i,value));
 return {apply,snapshot};
}
// body: the expected body text when another element (footnote numbers) changes it.
// ignoreEmptyLines / ignoreSpaces: GetString artefacts of columns (empty section
// lines) and frames (an extra space). Only passed when that element's own proof
// reads every body character with GetCharacter.
export function verifyHeader(meta,{text,steps,position=1,pages=1,body=text,ignoreEmptyLines=false,ignoreSpaces=false}){
 const normalize=value=>{let v=value;if(ignoreSpaces)v=v.replaceAll(' ','');if(ignoreEmptyLines)v=v.split('\n').filter(Boolean).join('\n');return v;};
 pages=validateHeaderPages(pages);position=validateHeaderPosition(position);steps=validateHeaderSteps(steps,text);const differences=[],snapshots={};
 const read=key=>{if(typeof meta[key]!=='string')throw Error('Missing header readback: '+key);return meta[key];};
 const eq=(phase,field,actual,expected)=>{if(actual!==expected)differences.push({phase,field,actual,expected});};
 const lines=(base,name,count)=>{const n=read(base+count);if(!/^\d+$/.test(n)||+n<1||+n>100)throw Error('Invalid header line count');return Array.from({length:+n},(_,i)=>read(base+name+(i+1))).join('\n');};
 const stages=[['initial',''],...steps.map((s,i)=>['step-'+i,s]),['before-save',steps.at(-1)??''],['reopened',steps.at(-1)??'']];
 for(const [stage,value] of stages){const base='header.'+stage+'.',state={positions:{},global:{}};
  for(let p=1;p<=4;p++){state.positions[p]={};for(const key of EACH)state.positions[p][key]=read(base+p+'.'+key);}
  for(const key of GLOBAL)state.global[key]=read(base+'global.'+key);
  const expected=[value?'1':'0','20','1',value,'',''];for(const [i,key] of EACH.entries())eq(stage,'target.'+key,state.positions[position][key],expected[i]);
  eq(stage,'distribution',state.global['振り分け'],'0');eq(stage,'oddEven',state.global['奇数偶数で別'],'0');
  if(stage!=='initial'){for(let p=1;p<=4;p++)if(p!==position)for(const key of EACH)eq(stage,p+'.'+key,state.positions[p][key],snapshots.initial.positions[p][key]);for(const key of GLOBAL)eq(stage,'global.'+key,state.global[key],snapshots.initial.global[key]);}
  if(value){state.area=read(base+'area');state.page=read(base+'page');state.x=read(base+'x');state.y=read(base+'y');state.text=lines(base,'text.','lines');eq(stage,'area',state.area,String(position+3));eq(stage,'page',state.page,'1');eq(stage,'text',state.text,value);for(const key of ['x','y'])if(!/^-?\d+(?:\.\d+)?$/.test(state[key]))throw Error('Invalid header coordinate');}
  state.bodyArea=read(base+'bodyArea');state.body=lines(base,'body.','bodyLines');eq(stage,'bodyArea',state.bodyArea,'1');eq(stage,'body',normalize(state.body),normalize(body.replace(/\r\n|\r/g,'\n')));if(pages===3)state.pages=verifyHeaderPages({read,eq,base,stage,value,position,text});snapshots[stage]=state;
 }
 return {snapshots,differences,proof:{version:3,position,pages,steps,checks:[],passed:!differences.length,reopened:!differences.some(d=>d.phase==='reopened'),scope:'Header/footer position '+position+' across '+pages+' page(s): exact string, enabled flag, 20mm margin, area and page; body and other header settings preserved',limitations:['Upper/lower left slot only, short horizontal one/three-page trial; no fields or odd/even distribution','Enabled flag is observed in T36 getter but omitted from public help return-key list','Coordinates recorded, not a visual geometry measurement; font inheritance is not verified','Three-page mode checks each body character page and final document page after explicit page breaks','Initial target header/footer and distribution settings explicitly normalized; other three positions guarded']}};
}
