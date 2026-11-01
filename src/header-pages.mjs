export function validateHeaderPages(pages=1){if(![1,3].includes(pages))throw Error('Header pages must be 1 or 3');return pages;}
export function headerPageSnapshot({text,value,position,stage,q}){
 const out=[],paragraphs=text.replace(/\r\n|\r/g,'\n').split('\n');
 const emit=(key,v)=>'%result.LinePrint('+q('header.'+stage+'.pages.'+key+'=')+' & '+v+')';
 for(let page=1;page<=3;page++){
  out.push('CancelAllRange()');
  if(value){out.push('ViewImageMarginArea(1)','ViewPrintImageMarginArea(1)',`JumpHeaderFooter(${position},${page})`,emit(page+'.area','GetCursorArea()'),'%hp=GetPosition(1)',emit(page+'.number','%hp('+q('ページ番号')+')'),'SelectAll(1)','%hs=GetString(1)','%hn=0','foreach %hv in %hs','%hn=%hn+1','%result.LinePrint('+q('header.'+stage+'.pages.'+page+'.text.')+' & %hn & "=" & %hv)','next',emit(page+'.lines','%hn'),'CancelAllRange()',`JumpHeaderFooter(5,${page})`);}
  out.push(`Jump(${page},1,1)`,emit(page+'.bodyArea','GetCursorArea()'));
  for(let i=0;i<paragraphs[page-1].length;i++)out.push(emit(page+'.char.'+i,'GetCharacter()'),emit(page+'.charPage.'+i,'GetPage()'),'CursorRight(1)');
 }
 out.push('JumpEnd()',emit('last','GetPage()'),'JumpStart()');return out;
}
export function verifyHeaderPages({read,eq,base,stage,value,position,text}){
 const paragraphs=text.replace(/\r\n|\r/g,'\n').split('\n'),observed=[];
 for(let page=1;page<=3;page++){
  const b=base+'pages.'+page+'.',entry={};
  if(value){entry.area=read(b+'area');entry.page=read(b+'number');eq(stage,'page'+page+'.area',entry.area,String(position+3));eq(stage,'page'+page+'.number',entry.page,String(page));const n=read(b+'lines');if(!/^\d+$/.test(n)||+n<1||+n>100)throw Error('Invalid header page line count');entry.text=Array.from({length:+n},(_,i)=>read(b+'text.'+(i+1))).join('\n');eq(stage,'page'+page+'.text',entry.text,value);}
  eq(stage,'page'+page+'.bodyArea',read(b+'bodyArea'),'1');entry.characters='';
  for(let i=0;i<paragraphs[page-1].length;i++){entry.characters+=read(b+'char.'+i);eq(stage,'page'+page+'.charPage.'+i,read(b+'charPage.'+i),String(page));}
  eq(stage,'page'+page+'.characters',entry.characters,paragraphs[page-1]);observed.push(entry);
 }
 eq(stage,'lastPage',read(base+'pages.last'),'3');return observed;
}
