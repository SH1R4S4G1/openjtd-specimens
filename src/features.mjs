// Public macro help: font t26m3px0/1ppw, paper t26m5icy/75pu,
// columns t26m6xdf/0jub, layout t26m81bo/3k8k, page numbers t26m8o11/6ntx. Values require runtime readback.
export const FEATURE_GROUPS = Object.freeze({
  font: { setter:'DocumentStyleFont', getter:'GetDocumentStyleFont', fields:{
    japaneseName:{jp:'和文フォント名',type:'string'}, japaneseStyle:{jp:'和文スタイル名',type:'string'},
    westernName:{jp:'欧文フォント名',type:'font'}, westernStyle:{jp:'欧文スタイル名',type:'string'},
    digitFont:{jp:'数字フォント',values:[10,11]}, size:{jp:'文字サイズ',min:5,max:50},
    sizeUnit:{jp:'文字サイズ単位',values:[1,2,3]}, scaleY:{jp:'縦拡大率',min:50,max:200},scaleX:{jp:'横拡大率',min:50,max:200}
  }},
  paper:{setter:'DocumentStylePaper',getter:'GetDocumentStylePaper',fields:{name:{jp:'用紙名',type:'string'}}},
  columns:{setter:'DocumentStyleColumns',getter:'GetDocumentStyleColumns',fields:{
    gap:{jp:'共通段間',min:0,max:1000},rule:{jp:'共通段間罫線',values:Array.from({length:16},(_,i)=>i)},
    twoEnabled:{jp:'二段組設定',values:[0,1]},twoGap:{jp:'二段組段間',nullable:true,min:0,max:1000},twoSpacing:{jp:'二段組文字間',nullable:true,min:-100,max:1000},twoChars:{jp:'二段組文字数',nullable:true,min:1,max:1000},
    threeEnabled:{jp:'三段組設定',values:[0,1]},threeGap:{jp:'三段組段間',nullable:true,min:0,max:1000},threeSpacing:{jp:'三段組文字間',nullable:true,min:-100,max:1000},threeChars:{jp:'三段組文字数',nullable:true,min:1,max:1000},
    gapUnit:{jp:'段間単位',values:[1,2]},spacingUnit:{jp:'字間単位',values:[1,2,3,100]}
  }},
  layout:{fields:{orientation:{jp:'文字組',values:[1,2]}}},
  // Page number settings of the document style (position, margin, decoration, start).
  page:{setter:'DocumentStylePage',getter:'GetDocumentStylePage',fields:{
    position:{jp:'ページ番号位置',values:[0,1,2,3,4,5,6]},margin:{jp:'ページマージン',min:0,max:100},marginUnit:{jp:'ページマージン単位',values:[1,2]},
    decoration:{jp:'ページ番号飾り',type:'string'},distribution:{jp:'ページ振り分け',values:[0,1]},kanji:{jp:'縦書き時漢数字',values:[0,1]},start:{jp:'番号初期値',min:-9,max:10000}
  }},
  // Typesetting of the document style (DocumentStyleRoman t26m338u, getter
  // t26m4qlq). Fields follow the setter argument order. Observed on Ichitaro
  // 2026 (APP-11): justification 2 is rejected; kinsoku 0 forces hanging,
  // pushIn and bracketOverlap to 0; hanging 1 and bracketOverlap 0 are
  // rejected while pushIn is 1; spreading writes are not reflected.
  typesetting:{setter:'DocumentStyleRoman',getter:'GetDocumentStyleRoman',fields:{
    justification:{jp:'ジャスティフィケーション',values:[0,1]},wordWrap:{jp:'ワードラップ',values:[0,1]},hyphenation:{jp:'ハイフネーション',values:[0,1]},
    separatorMargin:{jp:'区切りマージン',min:0,max:100},separatorMarginUnit:{jp:'区切りマージン単位',values:[1,2]},westernTight:{jp:'欧文密着',values:[0,1]},
    westernSpace:{jp:'和欧文間スペース',values:[0,1]},halfBracketsJapanese:{jp:'半角括弧類を和文ﾌｫﾝﾄにする',values:[0,1]},
    kinsoku:{jp:'禁則処理',values:[0,1]},lineStartForbidden:{jp:'行頭禁則文字',type:'string'},lineEndForbidden:{jp:'行末禁則文字',type:'string'},
    hanging:{jp:'ぶら下げ',values:[0,1]},pushIn:{jp:'追い込み',values:[0,1]},bracketOverlap:{jp:'括弧類の重なり処理',values:[0,1]},
    basePosition:{jp:'ベース位置',values:[1,2,3]},lineStartShift:{jp:'行頭シフト',min:0,max:100},keisenLineStretch:{jp:'罫線行自動伸縮',values:[0,1]},
    spreading:{jp:'字間の広げ方',values:[0,1]},japaneseFontHalfAlnum:{jp:'和文フォント半角英数字',values:[0,1]},wordRuleApprox:{jp:'行間罫線位置のWord近似',values:[0,1]}
  }}
});

export function validateFeatures(input) {
  const record=value=>{if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Array.isArray(value))throw new Error('Features must be plain records.');};
  record(input);const result={};
  for(const group of Reflect.ownKeys(input)){
    if(typeof group!=='string'||!Object.hasOwn(FEATURE_GROUPS,group)||!Object.hasOwn(Object.getOwnPropertyDescriptor(input,group),'value'))throw new Error('Unknown or non-data feature group.');
    const values=input[group];record(values);result[group]={};
    for(const field of Reflect.ownKeys(values)){
      if(typeof field!=='string'||!Object.hasOwn(FEATURE_GROUPS[group].fields,field)||!Object.hasOwn(Object.getOwnPropertyDescriptor(values,field),'value'))throw new Error('Unknown or non-data feature field.');
      const value=values[field],def=FEATURE_GROUPS[group].fields[field];
      if(def.type==='string'||def.type==='font'){
        if(!(def.type==='font'&&value===10)&&!(typeof value==='string'&&value.length<=120&&!/[\x00-\x1f\x7f\uD800-\uDFFF]/.test(value)))throw new Error('Invalid feature string: '+group+'.'+field);
      }else if(!Number.isFinite(value)||(def.values?!def.values.includes(value):value<def.min||value>def.max))throw new Error('Invalid feature number: '+group+'.'+field);
      result[group][field]=value;
    }
  }
  return result;
}

