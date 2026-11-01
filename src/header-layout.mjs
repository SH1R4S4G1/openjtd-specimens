// Final-state header/footer layout: left/center/right strings and optional
// different even pages. Public help: HeaderFooterArrangement t26m64tw,
// HeaderFooterEach t26m85k8, GetHeaderFooterEach t26m6pt4,
// GetHeaderFooterArrangement t26m3dys, JumpHeaderFooter t26m49f6.
// Probes (tmp/probe-header-slots-v*.mjs): with odd/even on, GetHeaderFooterEach(1|2)
// returns the odd-page strings and positions 5..8 cannot be read; a page's
// header area GetString joins the non-empty slots with single spaces.
export const HEADER_LAYOUT_FIELDS=['headerLayout'];
export const HEADER_LAYOUT_ITEM_FIELDS=['position','odd','even'];
const SLOTS=['left','center','right'];
const EACH=['付ける','ﾏｰｼﾞﾝ','ﾏｰｼﾞﾝ設定単位','文字列1','文字列2','文字列3'];
const check=(ok,message)=>{if(!ok)throw new Error('Header layout: '+message);};
const short=s=>typeof s==='string'&&/^[^\s\p{C}\p{M}\uD800-\uDFFF\u{10000}-\u{10FFFF}]{1,24}$/u.test(s);
const plain=v=>v&&Object.getPrototypeOf(v)===Object.prototype;

export function headerLayoutParagraphs(text){
  const paragraphs=typeof text==='string'?text.replace(/\r\n|\r/g,'\n').split('\n'):[];
  check(paragraphs.length>=1&&paragraphs.length<=8&&paragraphs.every(short),'body must be 1..8 paragraphs of 1..24 non-whitespace BMP characters');
  return paragraphs;
}
function slots(value,path){
  check(plain(value)&&Object.keys(value).length>=1&&Object.keys(value).every(k=>SLOTS.includes(k))&&Object.values(value).every(short),`${path} needs 1..3 of left/center/right, each 1..24 non-whitespace characters`);
  return Object.fromEntries(SLOTS.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
}
export function validateHeaderLayout(layout,text){
  const paragraphs=headerLayoutParagraphs(text);
  check(plain(layout)&&Object.keys(layout).every(k=>HEADER_LAYOUT_ITEM_FIELDS.includes(k)),'unknown field');
  check([1,2].includes(layout.position),'position must be 1 (header) or 2 (footer)');
  const result={position:layout.position,odd:slots(layout.odd,'odd')};
  // Different even pages need a second page: each paragraph becomes one page.
  if(layout.even!==undefined){result.even=slots(layout.even,'even');check(paragraphs.length===2,'even pages require exactly 2 paragraphs (one per page)');}
  return result;
}
export const headerLayoutPages=layout=>layout.even?2:1;

export function headerLayoutMacro({text,layout,q}){
  layout=validateHeaderLayout(layout,text);
  const emit=(key,value)=>`%result.LinePrint(${q(key+'=')} & ${value})`;
  const arg=(s,k)=>s[k]===undefined?'""':q(s[k]);
  const apply=['%phase="header-layout"','CancelMode()','CancelAllRange()','JumpStart()',`HeaderFooterArrangement(0,${layout.even?1:0})`,'SetHeaderFooter()',
    ...[1,2,3,4].filter(p=>p!==layout.position).map(p=>`HeaderFooterEach(${p},0,20,1,"","","")`),
    // Odd/even pages use positions 5/7 (odd top/bottom) and 6/8 (even top/bottom).
    `HeaderFooterEach(${layout.even?(layout.position===1?5:7):layout.position},1,20,1,${arg(layout.odd,'left')},${arg(layout.odd,'center')},${arg(layout.odd,'right')})`,
    ...(layout.even?[`HeaderFooterEach(${layout.position===1?6:8},1,20,1,${arg(layout.even,'left')},${arg(layout.even,'center')},${arg(layout.even,'right')})`]:[]),
    'SetHeaderFooter()'];
  function snapshot(stage){
    const base=`headerLayout.${stage}.`,out=['CancelMode()','CancelAllRange()','%hh=GetHeaderFooterArrangement()',emit(base+'oddEven',`%hh(${q('奇数偶数で別')})`),emit(base+'distribution',`%hh(${q('振り分け')})`)];
    for(let p=1;p<=4;p++){out.push(`%hh=GetHeaderFooterEach(${p})`);for(const [n,key] of EACH.entries())out.push(emit(`${base}each.${p}.${n}`,`%hh(${q(key)})`));}
    for(let page=1;page<=headerLayoutPages(layout);page++)out.push('CancelAllRange()','ViewImageMarginArea(1)','ViewPrintImageMarginArea(1)',`JumpHeaderFooter(${layout.position},${page})`,
      emit(`${base}page.${page}.area`,'GetCursorArea()'),'%hp=GetPosition(1)',emit(`${base}page.${page}.number`,`%hp(${q('ページ番号')})`),
      'SelectAll(1)','%hs=GetString(1)','%hn=0','foreach %hv in %hs','%hn=%hn+1',`%result.LinePrint(${q(base+'page.'+page+'.text.')} & %hn & "=" & %hv)`,'next',emit(`${base}page.${page}.lines`,'%hn'),
      'CancelAllRange()','JumpHeaderFooter(5,1)');
    out.push('JumpStart()',emit(base+'bodyArea','GetCursorArea()'),'SelectAll(1)','%hs=GetString(1)','%hn=0','foreach %hv in %hs','%hn=%hn+1',`%result.LinePrint(${q(base+'body.')} & %hn & "=" & %hv)`,'next',emit(base+'bodyLines','%hn'),'CancelAllRange()','JumpStart()');
    return out;
  }
  return {apply,snapshot};
}

export function verifyHeaderLayout(meta,{text,layout}){
  layout=validateHeaderLayout(layout,text);
  const differences=[],snapshots={};
  const read=key=>{if(typeof meta[key]!=='string')throw new Error('Missing header layout readback: '+key);return meta[key];};
  const lines=(prefix,countKey)=>{const n=read(countKey);if(!/^\d+$/.test(n)||+n>100)throw new Error('Invalid header layout line count');return Array.from({length:+n},(_,i)=>read(prefix+(i+1)));};
  const eq=(phase,field,actual,expected)=>{if(JSON.stringify(actual)!==JSON.stringify(expected))differences.push({phase,field,expected,actual});};
  const tokens=s=>SLOTS.filter(k=>s[k]!==undefined).map(k=>s[k]);
  for(const stage of ['before-save','reopened']){
    const base=`headerLayout.${stage}.`,state={oddEven:read(base+'oddEven'),distribution:read(base+'distribution'),each:{},pages:[]};
    eq(stage,'oddEven',state.oddEven,layout.even?'1':'0');eq(stage,'distribution',state.distribution,'0');
    for(let p=1;p<=4;p++){
      state.each[p]=EACH.map((_,n)=>read(`${base}each.${p}.${n}`));
      // With odd/even on, positions 1..4 report the odd-page strings.
      const want=p===layout.position?['1','20','1',layout.odd.left??'',layout.odd.center??'',layout.odd.right??'']:['0','20','1','','',''];
      eq(stage,`each.${p}`,p===layout.position?state.each[p]:[state.each[p][0],...state.each[p].slice(3)],p===layout.position?want:[want[0],...want.slice(3)]);
    }
    for(let page=1;page<=headerLayoutPages(layout);page++){
      const b=`${base}page.${page}.`,entry={area:read(b+'area'),number:read(b+'number'),text:lines(b+'text.',b+'lines')};
      eq(stage,`page.${page}.area`,entry.area,String(layout.position+3));eq(stage,`page.${page}.number`,entry.number,String(page));
      eq(stage,`page.${page}.tokens`,entry.text.join(' ').trim().split(/ +/),tokens(page===2?layout.even:layout.odd));
      state.pages.push(entry);
    }
    state.bodyArea=read(base+'bodyArea');state.body=lines(base+'body.',base+'bodyLines');
    eq(stage,'bodyArea',state.bodyArea,'1');eq(stage,'body',state.body.join('\n'),headerLayoutParagraphs(text).join('\n'));
    snapshots[stage]=state;
  }
  const checks=['before-save','reopened'].map(stage=>({stage,pages:snapshots[stage].pages.map(p=>p.text.join(' ')),passed:!differences.some(d=>d.phase===stage)}));
  return {snapshots,differences,proof:{version:1,layout,checks,passed:!differences.length,reopened:!differences.some(d=>d.phase==='reopened'),
    scope:'Header/footer slots for odd (or all) pages exact via GetHeaderFooterEach; enabled flag and odd/even setting; each page shows the requested non-empty strings in left-center-right order; other positions stay disabled and empty; body text unchanged',
    limitations:['Even-page strings cannot be read by getter; their slot (center or right) is not verified, only their order on page 2','Fixed 20mm margin; fields such as page numbers, fonts and geometry are not set or verified','Distribution (振り分け) is off; left/right side positions are not used']}};
}
