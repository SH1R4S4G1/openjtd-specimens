import { FOOTNOTE_BODY_FIELDS, FOOTNOTE_STEP_FIELDS } from './footnote-sequence.mjs';
import { FOOTNOTE_FIELDS } from './footnotes.mjs';
import { NAMED_STYLE_FIELDS } from './named-styles.mjs';
import { HEADER_FIELDS } from './headers.mjs';
import { DOCUMENT_COLUMNS_FIELDS } from './document-columns.mjs';
import { FRAME_ITEM_FIELDS } from './frames.mjs';
import { HEADER_LAYOUT_ITEM_FIELDS } from './header-layout.mjs';
import { STYLE_ITEM_FIELDS } from './style-definitions.mjs';
import { MACRO_CAPABILITIES } from './macro-catalog.mjs';
import { CHARACTER_PARAMETER_FIELDS, TEXT_TARGET_FIELDS } from './ranges.mjs';
import { KEISEN_PARAMETER_FIELDS, KEISEN_CELL_FIELDS } from './keisen.mjs';
import { FEATURE_GROUPS } from './features.mjs';
import { STYLE_FIELDS, SAMPLE_FIELDS } from './experiment.mjs';
import { SAMPLE_SCHEMA } from './sample-schema.mjs';
import { PARAGRAPH_TARGET_FIELDS, PARAGRAPH_OPERATION_FIELDS } from './paragraphs.mjs';
import { PDF_EXPORT_FIELDS } from './pdf-catalog.mjs';

// Field inventory comes from the definitions consumed by recipe validators.
// Public policy is intentionally separate: new internal fields must NOT become
// public (or silently internal-only) merely because they exist.
export function internalParameterInventory() {
  const inventory={'plain-text':['text']};
  const usedAttributes=new Set();
  for(const capability of MACRO_CAPABILITIES.filter(c=>c.implemented)) {
    if(capability.attribute || capability.attributes) {
      const attributes=capability.attributes ?? [capability.attribute];
      inventory[capability.id]=attributes.flatMap(attribute=>{
        usedAttributes.add(attribute);
        if(!CHARACTER_PARAMETER_FIELDS[attribute])throw new Error(`Missing parameter inventory for ${attribute}`);
        return CHARACTER_PARAMETER_FIELDS[attribute].map(field=>capability.attributes?`${attribute}.${field}`:field);
      });
    } else {
      const sources={
        'document-footnote':{trial:FOOTNOTE_FIELDS,body:FOOTNOTE_BODY_FIELDS,step:FOOTNOTE_STEP_FIELDS},
        'named-styles':{trial:NAMED_STYLE_FIELDS,styles:STYLE_ITEM_FIELDS},
        'document-header':{sample:HEADER_FIELDS},
  'document-columns-body':{sample:DOCUMENT_COLUMNS_FIELDS},
        'layout-frame':{frame:FRAME_ITEM_FIELDS},
        'header-layout':{layout:HEADER_LAYOUT_ITEM_FIELDS},
        'paragraph-attribute':{target:PARAGRAPH_TARGET_FIELDS,operation:PARAGRAPH_OPERATION_FIELDS},
        'paragraph-tabs':{target:PARAGRAPH_TARGET_FIELDS,operation:PARAGRAPH_OPERATION_FIELDS},
        'paragraph-decoration':{target:PARAGRAPH_TARGET_FIELDS,operation:PARAGRAPH_OPERATION_FIELDS},
        'range-text':{target:TEXT_TARGET_FIELDS},
        'body-keisen':{canvas:KEISEN_PARAMETER_FIELDS.canvas,line:KEISEN_PARAMETER_FIELDS.line,point:KEISEN_PARAMETER_FIELDS.point},
        'keisen-table':{canvas:KEISEN_PARAMETER_FIELDS.canvas,leading:KEISEN_PARAMETER_FIELDS.leading,table:KEISEN_PARAMETER_FIELDS.table,tableAttribute:KEISEN_PARAMETER_FIELDS.tableAttribute,tableRule:KEISEN_PARAMETER_FIELDS.tableRule,tableText:KEISEN_PARAMETER_FIELDS.tableText,cell:KEISEN_PARAMETER_FIELDS.point,cellValue:KEISEN_CELL_FIELDS},
        'keisen-table-structure':{tableBand:KEISEN_PARAMETER_FIELDS.tableBand,cellMerge:KEISEN_PARAMETER_FIELDS.cellMerge,cellSplit:KEISEN_PARAMETER_FIELDS.cellSplit,cellAddress:KEISEN_PARAMETER_FIELDS.point},
        'keisen-table-resize':{tableResize:KEISEN_PARAMETER_FIELDS.tableResize},
        'keisen-table-topology':{tableDivide:KEISEN_PARAMETER_FIELDS.tableDivide,tableMerge:KEISEN_PARAMETER_FIELDS.tableMerge},
        'pdf-from-jtd':{export:PDF_EXPORT_FIELDS},
      }[capability.id];
      if(!sources)throw new Error(`Unclassified internal capability: ${capability.id}`);
      inventory[capability.id]=Object.entries(sources).flatMap(([group,fields])=>fields.map(field=>`${group}.${field}`));
    }
  }
  for(const attribute of Object.keys(CHARACTER_PARAMETER_FIELDS))if(!usedAttributes.has(attribute))throw new Error(`Unregistered character capability: ${attribute}`);
  for(const [group,definition] of Object.entries(FEATURE_GROUPS))inventory[`document-${group}`]=Object.keys(definition.fields);
  inventory['document-style-source']=['styleSource'];
  inventory['document-style']=[...STYLE_FIELDS,...[...SAMPLE_FIELDS].filter(field=>!['id','settings','features','operations','keisenOperations','paragraphOperations','documentColumns','headerSteps','headerPosition','headerPages','namedStyle','footnote','frames','headerLayout','namedStyles','columnRange'].includes(field))];
  return inventory;
}

// field may list several public fields when one internal value is fed by each of them.
const publicField=(definition,field,note='対応する最終属性を指定')=>({status:'public',definition,field,note});
const fixed=note=>({status:'fixed',note});
const internal=note=>({status:'internal-only',note});
const classify=(fields,decision)=>Object.fromEntries(fields.map(field=>[field,{...decision}]));
const setOnly=fixed('setのみ。変更・解除の操作履歴は外部要求に公開しない');
export const PARAMETER_EXPOSURE={
  // PDF Catalog (CR-006): its own schema; every exportPdf argument is derived by bin/ichitaro-pdf.mjs.
  'pdf-from-jtd':{'export.jtd':fixed('PDF Catalogのdocuments[].fileの写し（出力先のjtd/<document-id>.jtd）。写しのSHA-256はdocuments[].sha256と一致が必要'),'export.pdf':fixed('出力先のpdf/<document-id>.pdfに固定'),'export.workDir':fixed('出力先のpdf/<document-id>.macroに固定'),'export.existing':fixed('PDF Catalogでは常にtrue（WarningMode(0)、シート数・文書マクロ数の記録）。--pdfではfalse'),'export.sheetPdfPrefix':fixed('出力先のpdf/<document-id>.sheet-に固定。2シート以上の文書だけ、シートごとに<prefix><i>.pdfを保存（0.17.0）')},
  'document-footnote':{'trial.text':internal('旧単独脚注Recipe互換のみ'),'trial.steps':publicField('footnoteDocument','notes','外部は最終脚注集合。履歴は内部Recipeのみ'),'body.text':publicField('footnoteDocument','text'),'step.action':fixed('外部集合からaddを構成。modify/removeは内部履歴のみ'),...Object.fromEntries(['id','paragraph','offset','text'].map(k=>['step.'+k,publicField('footnote',k)]))},
  'named-styles':{...classify(['trial.kind','trial.steps'],internal('定義・適用・直接指定・再定義・解除の履歴試験は内部Recipeのみ。外部は最終状態のstyles')),'styles.kind':publicField('styleDefinition','kind'),'styles.name':publicField('styleDefinition','name'),'styles.sizePt':publicField('styleDefinition','sizePt'),'styles.paragraph':publicField('styleApplication','paragraph'),'styles.style':publicField('styleApplication','style')},
  'document-header':{'sample.headerSteps':publicField('headerFooter','text','外部は最終文字列1個。設定・変更・解除の履歴は内部Recipeのみ'),'sample.headerPosition':publicField('headerFooter','position','header→1（上端）、footer→2（下端）'),'sample.headerPages':publicField('paragraphsDocument','pageBreaks','true→3ページ（各段落を別ページ）、省略→1ページ')},
  'header-layout':{'layout.position':publicField('headerFooter','position','header→1、footer→2'),'layout.odd':publicField('headerFooter',['text','center','right'],'text→左、center→中央、right→右（全ページまたは奇数ページ）'),'layout.even':publicField('headerFooter','evenPages','偶数ページの文字列。2段落（各ページ1段落）が必要')},
  'layout-frame':{...Object.fromEntries(['name','left','top','width','height','text'].map(k=>['frame.'+k,publicField('frame',k)])),'frame.writingMode':publicField('frame','writingMode','horizontal→1、vertical→2'),'frame.border':publicField('frame','border','true→1、false/省略→0')},
  'document-columns-body':{'sample.documentColumns':publicField('paragraphsDocument','columns','外部は最終段数2または3。段数の変更・解除履歴は内部Recipeのみ'),'sample.columnRange':publicField('columnRange',['from','to'],'段組を適用する段落範囲（0始まり、両端を含む）。省略時は文書全体')},
  'paragraph-attribute':{'target.id':fixed('コンパイラが段落IDを生成'),'target.index':publicField('paragraphFormat','paragraph','0始まり→1始まりに変換'),'target.expected':fixed('本文の該当段落から導出'),'operation.target':fixed('コンパイラが構成'),
    'operation.attribute':fixed('alignment／indent／spacingの指定からalignment・indent・paragraphSpacingを構成。単成分の内部属性は履歴試験用'),'operation.mode':setOnly,
    'operation.value':publicField('paragraphFormat',['alignment','indent','spacing'],'left→1、center→2、right→3、distributed→10。indent・spacingの各成分も同じ値へ対応'),'operation.unit':publicField('paragraphFormat',['indent','spacing'],'indent: mm→1、columns→101／spacing: mm→1、percent→100')},
  'paragraph-decoration':classify(['target.id','target.index','target.expected','operation.target','operation.attribute','operation.mode','operation.value','operation.unit'],internal('段落飾りの線種・線色・塗り濃度／パターンを単属性の内部Recipeで試作。getterがなくsaved・要画面確認のまま保持し、検証済みにはしない。外部非公開')),
  'paragraph-tabs':{'target.id':fixed('コンパイラが段落IDを生成'),'target.index':publicField('paragraphFormat','paragraph','0始まり→1始まり'),'target.expected':fixed('本文の該当段落から導出'),'operation.target':fixed('コンパイラが構成'),'operation.attribute':fixed('tabs'),'operation.mode':setOnly,'operation.value':publicField('paragraphFormat','tabs','positions。タブ種類は左揃え固定で未検証'),'operation.unit':publicField('paragraphFormat','tabs','mm→1、columns→101')},
  'plain-text':{text:publicField('textDocument','text')},
  'range-text':{
    'target.id':fixed('コンパイラが範囲IDを生成'), 'target.kind':fixed('textのみ'),
    'target.start':publicField('range','start'),'target.end':publicField('range','end'),'target.expected':publicField('range','text'),
  },
  'character-scaleX':{mode:setOnly,value:publicField('scale','percent')},
  'character-size':{mode:setOnly,value:publicField('size','points')},
  'character-spacing':{mode:setOnly,value:publicField('spacing','value'),unit:publicField('spacing','unit','mm→1、percent→100')},
  'closely-spacing':{mode:setOnly},
  'evenly-spacing':{mode:setOnly,value:publicField('evenly','width'),unit:publicField('evenly','unit'),widthMode:fixed('絶対幅のみ。相対幅は未公開')},
  ruby:{mode:setOnly,reading:publicField('ruby','reading'),
    evenly:publicField('ruby','alignment','distributed→1、それ以外→0。省略時は一太郎APIの既定動作'),
    position:publicField('ruby','alignment','left→1、center→2、right→3。distributed時は適用対象外'),
    placement:publicField('ruby','placement','above→1、below→2'),sizeMm:publicField('ruby','sizeMm'),distanceMm:publicField('ruby','distanceMm')},
  'character-decoration':{...Object.fromEntries(['underline','strikeThrough','fill'].flatMap(k=>[[k+'.mode',setOnly],[k+'.value',publicField('decoration',k,k==='fill'?'塗り濃度1..100／パターン101..107のコード':'線種コード1..15')],[k+'.color',publicField('decoration','color','範囲内の全装飾で共有する1色。同じ値を各呼出へ渡す')]]))},
  'character-font-style':{mode:setOnly,value:publicField('fontStyle','style','regular→標準、bold→太字、italic→斜体')},
  'character-color':{mode:setOnly,value:publicField('textColor','color')},
  'character-font':{mode:setOnly,value:publicField('fontName','name')},
  'character-border':{mode:setOnly,value:publicField('border','lineType','線種コード1..15'),color:publicField('border','color','他の文字装飾と共有する飾り色')},
  'body-keisen':classify(['canvas.rows','canvas.columns','canvas.leading','line.type','line.mode','line.from','line.to','line.lineType','line.color','point.row','point.column'],internal('独立した本文罫線の外部要求は未公開')),
  'keisen-table':{
    'canvas.leading':publicField('tableDocument','leadingParagraphs','表の前の本文の段落（CR-009）。表と座標を、段落が占める行の分（折り返しを含む。実行時に読む）だけ下へずらす'),'leading.text':publicField('leadingParagraph','text','段落の字（空なら空行。長ければ折り返す）'),'leading.size':publicField('leadingParagraph','sizePt','その段落の字の大きさ（pt）。省けば文書の大きさ'),'leading.spacing':publicField('leadingParagraph','spacing','その段落の前と後の空き（mm または ％）'),
    'tableText.type':fixed('tableText'),'tableText.cell':publicField('tableDocument','cells','文字を持つセル。結合セルは左上位置で指定'),
    'tableText.text':publicField('tableCell','text','最終状態のセル文字。結合後のセル幅から決まる文字数上限を検査。置換・消去の履歴は内部Recipeのみ'),
    ...classify(['tableRule.type','tableRule.axis','tableRule.boundary','tableRule.lineType','tableRule.color'],internal('表境界単位の変更・復元履歴は内部Recipeのみ。外部の最終状態契約には未公開')),
    ...classify(['canvas.rows','canvas.columns'],fixed('空白観測キャンバスの大きさはコンパイラが決定')),
    'table.type':fixed('table'),'table.rows':publicField('tableDocument',['rows','rowHeights'],'行数と行高（通常行単位）から罫線境界列へ変換'),
    'table.columns':publicField('tableDocument',['columns','columnWidths'],'列数と列幅（半角単位・偶数）から罫線境界列へ変換'),
    'table.lineType':publicField('tableDocument','lineType','省略時は一太郎の現在の設定値'),'table.color':publicField('tableDocument','color','省略時は一太郎の現在の設定値'),
    'tableAttribute.type':fixed('tableAttribute'),
    'tableAttribute.attribute':fixed('cells.attributesのキーから導出。全表一括指定は未公開'),
    'tableAttribute.value':fixed('cells.attributesの値から導出'),
    'tableAttribute.cell':publicField('tableDocument','cells','最終状態を持つセル集合。順序は正規化'),
    'cell.row':publicField('tableCell','row'),'cell.column':publicField('tableCell','column'),
    ...Object.fromEntries(KEISEN_CELL_FIELDS.map(field=>['cellValue.'+field,publicField('cellAttributes',field)])),
  },
  'keisen-table-resize':classify(['tableResize.type','tableResize.axis','tableResize.index','tableResize.delta'],internal('寸法変更の操作履歴は未公開')),
  'keisen-table-structure':{
    ...classify(['tableBand.type','tableBand.axis','tableBand.mode','tableBand.index','tableBand.size','cellSplit.type','cellSplit.cell','cellSplit.rows','cellSplit.columns'],internal('行列の追加・削除と分割の操作履歴は内部Recipeのみ。外部は最終状態の行列数・寸法・結合で表す')),
    'cellMerge.type':publicField('tableDocument','merges','結合矩形ごとに1つのcellMergeへ変換。重なりは拒否'),'cellMerge.from':publicField('tableMerge','from','最終状態の結合矩形の左上'),'cellMerge.to':publicField('tableMerge','to','最終状態の結合矩形の右下'),
    'cellAddress.row':publicField('tableAddress','row'),'cellAddress.column':publicField('tableAddress','column'),
  },
  'keisen-table-topology':classify(['tableDivide.type','tableDivide.axis','tableDivide.parts','tableMerge.type','tableMerge.axis','tableMerge.boundary'],internal('分割・結合の操作履歴は未公開')),
  'document-font':{
    japaneseName:publicField('font','name'),size:publicField('font','sizePt'),sizeUnit:fixed('ポイント単位3のみ'),
    ...classify(['japaneseStyle','westernName','westernStyle','digitFont','scaleY','scaleX'],internal('文書フォントのこの属性は未公開')),
  },
  'document-typesetting':{
    justification:publicField('typesetting','justification','true→1（必ず行末まで揃える）、false→0。2は一太郎が拒否'),kinsoku:publicField('typesetting','kinsoku','true→1、false→0'),
    lineStartForbidden:publicField('typesetting','lineStartForbidden','文字列全体を置換'),lineEndForbidden:publicField('typesetting','lineEndForbidden','文字列全体を置換'),
    hanging:publicField('typesetting','hanging','true→1。追い込み0の明示が必要'),pushIn:publicField('typesetting','pushIn'),bracketOverlap:publicField('typesetting','bracketOverlap','false→0。追い込み0の明示が必要'),
    spreading:internal('設定値が反映されないため未公開（記録のみ）'),
    ...classify(['wordWrap','hyphenation','separatorMargin','separatorMarginUnit','westernTight','westernSpace','halfBracketsJapanese','basePosition','lineStartShift','keisenLineStretch','japaneseFontHalfAlnum','wordRuleApprox'],internal('欧文・ベース位置等の体裁は未公開（全項目を保存前後で記録・比較）')),
  },
  'document-page':{position:publicField('pageNumber','position','none→0、bottom-left→1、bottom-center→2、bottom-right→3、top-left→4、top-center→5、top-right→6'),margin:publicField('pageNumber','marginMm'),marginUnit:fixed('mm（1）に固定'),decoration:publicField('pageNumber','decoration','保存される文字列。印字結果は未検証'),start:publicField('pageNumber','start'),distribution:internal('ページ振り分けは未公開'),kanji:internal('縦書き時の漢数字は未公開')},
  'document-paper':{name:publicField('page',['paper','orientation'],'「<paper> 単票・縦方向／横方向」の用紙名へ変換。実機確認済みの10名のみ')},
  'document-style-source':{styleSource:publicField('textDocument','styleSource','new-document→設定しない（基準試料・試料とも文書スタイルのsetterを呼ばない）。読み戻し値を記録')},
  'document-layout':{orientation:publicField('textDocument','writingMode','horizontal→1、vertical→2。範囲注釈は横書きのみ')},
  'document-columns':{gap:publicField('columnFormat','gapMm','mm（gapUnit=1）'),rule:publicField('columnFormat','rule'),
    twoEnabled:publicField('columnFormat','twoColumn','指定時に1'),twoGap:publicField('columnFormat','twoColumn','gapMm'),twoChars:publicField('columnFormat','twoColumn','chars'),
    threeEnabled:publicField('columnFormat','threeColumn','指定時に1'),threeGap:publicField('columnFormat','threeColumn','gapMm'),threeChars:publicField('columnFormat','threeColumn','chars'),
    twoSpacing:fixed('一太郎が字数から計算した値を読み戻して記録。要求値にしない'),threeSpacing:fixed('一太郎が字数から計算した値を読み戻して記録。要求値にしない'),
    gapUnit:fixed('mm（1）に固定'),spacingUnit:fixed('設定しない。読み戻した単位を記録')},
  'document-style':Object.fromEntries([...STYLE_FIELDS,'layoutPriority'].map(field=>[field,publicField('documentStyle',field,'優先側と余白は必須、従属側は任意。明示値を保存・再読込で照合。字間・行間は%、余白はmm')])),
};

function schemaFields(node,schema) {
  if(node.$ref)node=schema.$defs[node.$ref.split('/').at(-1)];
  if(!node)throw new Error('Missing publication schema definition');
  return new Set([...Object.keys(node.properties ?? {}),...(node.oneOf ?? []).flatMap(branch=>[...schemaFields(branch,schema)])]);
}

export function buildParameterExposure({inventory=internalParameterInventory(),policy=PARAMETER_EXPOSURE,schema=SAMPLE_SCHEMA}={}) {
  const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
  if(!same(Object.keys(inventory),Object.keys(policy)))throw new Error('Parameter exposure capability inventory/policy mismatch');
  const parameters=[];
  for(const [capability,fields] of Object.entries(inventory)) {
    if(!same(fields,Object.keys(policy[capability])))throw new Error(`Unclassified or obsolete internal parameter: ${capability}`);
    for(const parameter of fields) {
      const decision=policy[capability][parameter];
      if(!['public','fixed','internal-only'].includes(decision.status)||!decision.note?.trim())throw new Error(`Invalid parameter exposure: ${capability}.${parameter}`);
      if(decision.status==='public') {
        if(!schema.$defs[decision.definition]||![].concat(decision.field).every(field=>schemaFields(schema.$defs[decision.definition],schema).has(field)))throw new Error(`Missing public parameter: ${capability}.${parameter}`);
      } else if(decision.definition || decision.field)throw new Error(`Nonpublic parameter has a public mapping: ${capability}.${parameter}`);
      parameters.push({capability,parameter,...decision});
    }
  }
  return {schemaVersion:1,parameters};
}

export function checkPublicParameterCoverage(bindings,schema=SAMPLE_SCHEMA) {
  const {parameters}=buildParameterExposure({schema});
  for(const binding of Object.values(bindings)) {
    for(const field of schemaFields(schema.$defs[binding.definition],schema)) {
      // Structural containers/discriminators are not capability parameters.
      const property=schema.$defs[binding.definition].properties?.[field];
      if(field==='kind'&&property?.const)continue;
      if(property?.$ref && Object.values(bindings).some(b=>property.$ref===`#/$defs/${b.definition}`))continue;
      if(property?.items?.$ref==='#/$defs/annotation')continue;
      if(!parameters.some(p=>p.status==='public'&&p.definition===binding.definition&&[].concat(p.field).includes(field)))throw new Error(`Public parameter has no internal mapping: ${binding.definition}.${field}`);
    }
  }
}

export function renderParameterExposure(exposure=buildParameterExposure()) {
  const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('|','&#124;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('`','&#96;').replace(/\r?\n/g,'<br>');
  return ['# 内部パラメータと外部公開の対応（自動生成）','',
    '<!-- Generated by node scripts/generate-capabilities.mjs. DO NOT EDIT. -->','',
    '直接編集禁止。[保守手順](../developer-guide.md) / [機械可読版](../../parameter-exposure.json) / [外部パラメータ詳細](sample-capabilities.md)','',
    'publicは外部の意味ベースの指定へ対応、fixedはコンパイラが固定/導出（自由指定不可）、internal-onlyは未公開です。対応は同じ値域の全面公開を意味しません。外部値域は正式Schemaに従います。範囲のtarget/type/attribute等の参照・識別子はコンパイラが構成します。表は各操作/セル属性を展開しています。未実装の能力には実行パラメータがありません。','',
    '| 内部Capability | 内部パラメータ | 公開区分 | 外部Schema / field | 対応・未公開理由 |','|---|---|---|---|---|',
    ...exposure.parameters.map(p=>`| ${escape(p.capability)} | ${escape(p.parameter)} | ${p.status} | ${p.status==='public'?`[${escape([].concat(p.field).map(field=>p.definition+'.'+field).join(', '))}](../../schemas/sample-catalog.schema.json#/$defs/${p.definition})`:'—'} | ${escape(p.note)} |`),''].join('\n');
}
