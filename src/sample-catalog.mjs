import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SAMPLE_SCHEMA, APPLICATION_VERSION } from './sample-schema.mjs';
import { validateSchema, assertJsonData, quoteValue } from './schema-validation.mjs';
import { buildCapabilities, REQUEST_BINDINGS } from './sample-capabilities.mjs';
import { COLUMN_BASE_FEATURES } from './document-columns.mjs';
import { expandExperiment } from './experiment.mjs';
import { LONG_TEXT_THRESHOLD, bodyParagraphs } from './body-paragraphs.mjs';

const fail = (location, message) => { throw Object.assign(new Error(`${location}: ${message}`),
  {code:'ERR_SAMPLE_SEMANTIC', path:location}); };
const defaults = Object.freeze({chars:40,lines:40,characterSpacing:1,lineSpacing:60,marginTop:30,marginBottom:30,marginLeft:30,marginRight:30});
const units = {mm:1,inch:2,point:3,character:101,percent:100};
const reserved = /^(baseline|con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// Places for error messages: a table cell by row and column (1-based) and a
// merge by its from and to cells.
const cellAt = ({row, column}) => `(row ${row}, column ${column})`;
const mergeAt = ({from, to}) => `${cellAt(from)}-${cellAt(to)}`;
const characters = text => { const count = [...text].length; return `${count} character${count === 1 ? '' : 's'}`; };

// Document-style column format; spacing is left to Ichitaro and recorded.
function columnFeature(format) {
  const result = {};
  if (format.gapMm !== undefined) Object.assign(result,{gap:format.gapMm,gapUnit:1});
  if (format.rule !== undefined) result.rule = format.rule;
  for (const [key,prefix] of [['twoColumn','two'],['threeColumn','three']]) if (format[key]) Object.assign(result,{[prefix+'Enabled']:1,[prefix+'Gap']:format[key].gapMm,[prefix+'Chars']:format[key].chars,gapUnit:1});
  return result;
}

const PAGE_POSITIONS = {none:0,'bottom-left':1,'bottom-center':2,'bottom-right':3,'top-left':4,'top-center':5,'top-right':6};
function pageFeature(pageNumber) {
  return {position:PAGE_POSITIONS[pageNumber.position],...(pageNumber.marginMm!==undefined?{margin:pageNumber.marginMm,marginUnit:1}:{}),
    ...(pageNumber.start!==undefined?{start:pageNumber.start}:{}),...(pageNumber.decoration!==undefined?{decoration:pageNumber.decoration}:{})};
}
// APP-11. Dependencies observed on Ichitaro 2026: kinsoku off forces the
// three dependent switches off; hanging on and bracketOverlap off are rejected
// unless pushIn is off in the same call. Requests must state that explicitly.
function typesettingFeature(id, t) {
  const on = key => t[key] === true, off = key => t[key] === false;
  if (off('kinsoku') && ['hanging','pushIn','bracketOverlap'].some(on)) fail(id, 'typesetting: kinsoku false turns hanging, pushIn and bracketOverlap off');
  if (on('hanging') && !off('pushIn')) fail(id, 'typesetting: hanging true requires pushIn false');
  if (off('bracketOverlap') && !off('pushIn')) fail(id, 'typesetting: bracketOverlap false requires pushIn false');
  for (const key of ['lineStartForbidden','lineEndForbidden']) if (t[key] !== undefined && /[\s\p{C}\uD800-\uDFFF]/u.test(t[key])) fail(id, `typesetting: ${key} must be non-whitespace BMP characters`);
  return Object.fromEntries(Object.entries(t).map(([key, value]) => [key, typeof value === 'boolean' ? Number(value) : value]));
}

// A range must name the exact text at half-open offsets. The message names the
// annotation by its index in the request, the text found there and the rule.
function checkRange(id, text, range, position) {
  const where = `annotations[${position}].range`, found = JSON.stringify(text.slice(range.start,range.end));
  const rule = `body length ${text.length}; start counts from 0 and end is exclusive`;
  if (range.end <= range.start) fail(id,`${where}: end ${range.end} must be greater than start ${range.start} (text ${JSON.stringify(range.text)}; ${rule})`);
  if (range.end > text.length) fail(id,`${where}: [${range.start},${range.end}) runs past the end of the body (text ${JSON.stringify(range.text)}; found ${found}; ${rule})`);
  if (range.text !== text.slice(range.start,range.end)) fail(id,`${where}: text ${JSON.stringify(range.text)} is not the text at [${range.start},${range.end}) (found ${found}; ${rule})`);
}

function compileSample(sample) {
  const doc = sample.document;
  const recipe = {schemaVersion:1,name:sample.id,text:'',defaults:{...defaults},samples:[]};
  const variant = {id:sample.id,settings:{},features:{layout:{orientation:1}}};
  const used = new Set();
  if(doc.kind==='footnotes'){
    used.add('document-footnote');recipe.text=doc.text;delete variant.features;
    variant.footnote={steps:[...doc.notes].sort((a,b)=>a.paragraph-b.paragraph||a.offset-b.offset).map(n=>({action:'add',...n}))};
  } else if (doc.kind === 'paragraphs') {
    const paragraphs = doc.text.split('\n');
    // Tab characters are allowed only when paragraph formats are the only element:
    // the other elements compare GetString output, which renders a tab as a space.
    const tabsAllowed = doc.paragraphFormats && ['headerFooter','columns','frames','notes'].every(key => doc[key] === undefined);
    const badParagraph = paragraphs.findIndex(p => p.length > 24 || !/^[^\s\p{C}\p{M}\uD800-\uDFFF\u{10000}-\u{10FFFF}]+$/u.test(tabsAllowed ? p.replaceAll('\t','') : p));
    if (paragraphs.length > 8 || badParagraph >= 0) fail(sample.id,`text must be 1..8 paragraphs separated by LF, each 1..24 non-whitespace BMP characters (tabs only with paragraphFormats alone); ${paragraphs.length > 8
      ? `got ${paragraphs.length} paragraphs` : `paragraph ${badParagraph} (counting from 0) is ${quoteValue(paragraphs[badParagraph])}, ${characters(paragraphs[badParagraph])}`}`);
    const elements = ['headerFooter','columns','paragraphFormats','frames','notes','styles'].filter(key => doc[key] !== undefined);
    if (!elements.length) fail(sample.id,'specify at least one of headerFooter, columns, paragraphFormats, frames, notes or styles');
    if (doc.styles && elements.length > 1) fail(sample.id,'styles cannot combine with other elements');
    // Combinations verified on the real application (see docs/combinations.md).
    if (doc.notes && elements.some(key => !['notes','headerFooter'].includes(key))) fail(sample.id,'notes combine only with headerFooter');
    recipe.text = doc.text; delete variant.features;
    if (doc.pageBreaks && !doc.headerFooter) fail(sample.id,'pageBreaks requires headerFooter');
    if (doc.pageBreaks && elements.length > 1) fail(sample.id,'pageBreaks (three pages) cannot combine with other elements');
    if (doc.font || doc.page || doc.columnFormat || doc.pageNumber || doc.typesetting) {
      variant.features = {};
      if (doc.pageNumber) { used.add('document-page'); variant.features.page = pageFeature(doc.pageNumber); }
      if (doc.typesetting) { used.add('document-typesetting'); variant.features.typesetting = typesettingFeature(sample.id, doc.typesetting); }
      if (doc.columnFormat) { used.add('document-columns'); variant.features.columns = columnFeature(doc.columnFormat); }
      if (doc.font) { used.add('document-font'); variant.features.font = {...(doc.font.name ? {japaneseName:doc.font.name} : {}),...(doc.font.sizePt !== undefined ? {size:doc.font.sizePt,sizeUnit:3} : {})}; }
      if (doc.page) { used.add('document-paper'); variant.features.paper = {name:`${doc.page.paper} 単票・${doc.page.orientation==='portrait'?'縦':'横'}方向`}; }
    }
    if (doc.style) {
      used.add('document-style');
      const {layoutPriority,...settings} = doc.style;
      variant.settings = settings; variant.layoutPriority = layoutPriority;
    }
    if (doc.styles) {
      used.add('named-styles');
      variant.namedStyles = {definitions:doc.styles.definitions.map(d=>({...d})),applications:(doc.styles.applications??[]).map(a=>({...a}))};
    }
    if (doc.notes) {
      used.add('document-footnote');
      variant.footnote = {steps:[...doc.notes].sort((a,b)=>a.paragraph-b.paragraph||a.offset-b.offset).map(n=>({action:'add',...n}))};
    }
    const slotLayout = doc.headerFooter && (doc.headerFooter.center !== undefined || doc.headerFooter.right !== undefined || doc.headerFooter.evenPages !== undefined);
    if (doc.headerFooter && doc.headerFooter.text === undefined && !slotLayout) fail(sample.id,'headerFooter needs text, center or right');
    if (slotLayout) {
      // Center/right slots and even pages use the final-state header layout trial.
      used.add('header-layout');
      if (elements.length > 1 || doc.pageBreaks) fail(sample.id,'headerFooter with center, right or evenPages cannot combine with other elements or pageBreaks');
      const slots = value => Object.fromEntries([['left',value.text],['center',value.center],['right',value.right]].filter(([,v])=>v!==undefined));
      variant.headerLayout = {position:doc.headerFooter.position==='footer'?2:1,odd:slots(doc.headerFooter),...(doc.headerFooter.evenPages?{even:slots(doc.headerFooter.evenPages)}:{})};
      if (Object.keys(variant.headerLayout.odd).length === 0) fail(sample.id,'headerFooter needs at least one string for odd pages');
    } else if (doc.headerFooter) {
      used.add('document-header');
      if (paragraphs.length !== 3) fail(sample.id,`headerFooter requires exactly 3 paragraphs (got ${paragraphs.length})`);
      Object.assign(variant,{headerSteps:[doc.headerFooter.text],headerPosition:doc.headerFooter.position==='footer'?2:1,headerPages:doc.pageBreaks?3:1});
    }
    if (doc.columns !== undefined) {
      used.add('document-columns-body');
      if (paragraphs.length < 3) fail(sample.id,`columns requires 3..8 paragraphs (got ${paragraphs.length})`);
      variant.documentColumns = [doc.columns];
      if (doc.columnRange) {
        if (doc.columnRange.to < doc.columnRange.from || doc.columnRange.to >= paragraphs.length || (doc.columnRange.from === 0 && doc.columnRange.to === paragraphs.length - 1)) fail(sample.id,`columnRange must lie inside the text and must not cover the whole document (from ${doc.columnRange.from}, to ${doc.columnRange.to}; the text has paragraphs 0..${paragraphs.length - 1})`);
        variant.columnRange = {from:doc.columnRange.from,to:doc.columnRange.to};
      }
    }
    if (doc.columnRange && doc.columns === undefined) fail(sample.id,'columnRange requires columns');
    if (doc.frames) {
      used.add('layout-frame');
      variant.frames = doc.frames.map(({writingMode,border,...frame})=>({...frame,writingMode:writingMode==='vertical'?2:1,border:border?1:0}));
    }
    if (doc.paragraphFormats) {
      used.add('paragraph-attribute');
      if (paragraphs.length < 3) fail(sample.id,`paragraphFormats requires 3..8 paragraphs (got ${paragraphs.length})`);
      // position keeps the index in the request for error messages.
      const formats = doc.paragraphFormats.map((format,position)=>({...format,position})).sort((a,b)=>a.paragraph-b.paragraph);
      recipe.paragraphTargets = []; variant.paragraphOperations = [];
      for (const [index, format] of formats.entries()) {
        const where = `paragraphFormats[${format.position}]`;
        if (format.paragraph >= paragraphs.length) fail(sample.id,`${where}: paragraph index outside text (paragraph ${format.paragraph}; the text has paragraphs 0..${paragraphs.length - 1})`);
        if (index && formats[index-1].paragraph === format.paragraph) fail(sample.id,`${where}: duplicate paragraph format (paragraphFormats[${formats[index-1].position}] also formats paragraph ${format.paragraph})`);
        if (format.alignment === undefined && !format.indent && !format.spacing && !format.tabs) fail(sample.id,`${where}: paragraph format requires alignment, indent, spacing or tabs`);
        const target = `paragraph-${format.paragraph}`;
        recipe.paragraphTargets.push({id:target,index:format.paragraph+1,expected:paragraphs[format.paragraph]});
        const ops = variant.paragraphOperations;
        if (format.alignment !== undefined) ops.push({target,attribute:'alignment',mode:'set',value:{left:1,center:2,right:3,distributed:10}[format.alignment]});
        if (format.indent) {
          const {unit,start,end,firstLineStart,firstLineEnd} = format.indent;
          const value = Object.fromEntries(Object.entries({start,end,firstStart:firstLineStart,firstEnd:firstLineEnd}).filter(([,v])=>v!==undefined));
          ops.push({target,attribute:'indent',mode:'set',value,unit:unit==='mm'?1:101});
        }
        if (format.spacing) {
          const {unit,before,after} = format.spacing;
          ops.push({target,attribute:'paragraphSpacing',mode:'set',value:Object.fromEntries(Object.entries({before,after}).filter(([,v])=>v!==undefined)),unit:unit==='mm'?1:100});
        }
        if (format.tabs) {
          used.add('paragraph-tabs');
          ops.push({target,attribute:'tabs',mode:'set',value:[...format.tabs.positions],unit:format.tabs.unit==='mm'?1:101});
        }
      }
    }
  } else if (doc.kind === 'keisen-table') {
    used.add('keisen-table');
    const heights = doc.rowHeights ?? Array(doc.rows).fill(2), widths = doc.columnWidths ?? Array(doc.columns).fill(4);
    if (heights.length !== doc.rows || widths.length !== doc.columns) fail(sample.id, `rowHeights/columnWidths need one entry per row/column (rowHeights has ${heights.length} for ${doc.rows} rows, columnWidths ${widths.length} for ${doc.columns} columns)`);
    const odd = widths.findIndex(w => w % 2);
    if (odd >= 0) fail(sample.id, `columnWidths are half-width units and must be even (full-width character boundaries); columnWidths[${odd}] is ${widths[odd]}`);
    const sum = list => list.reduce((a, b) => a + b, 0);
    if (sum(heights) > 9 || sum(widths) > 18) fail(sample.id, `table exceeds the observation canvas: total row height <= 9 lines, total column width <= 18 half-width columns (got ${sum(heights)} lines and ${sum(widths)} half-width columns)`);
    const boundaries = (start, sizes) => sizes.reduce((list, size) => [...list, list.at(-1) + size], [start]);
    const rows = boundaries(2, heights), columns = boundaries(3, widths);
    // Larger, sized or merged tables use the structured internal path, which
    // draws every rule explicitly and therefore needs explicit line type/color.
    const structured = doc.rows > 2 || doc.columns > 2 || heights.some(h => h !== 2) || widths.some(w => w !== 4) || doc.merges !== undefined;
    if (structured && (doc.lineType === undefined || doc.color === undefined)) fail(sample.id, 'tables larger than 2x2, with rowHeights/columnWidths or merges require explicit lineType and color');
    if (structured) {
      recipe.keisenCanvas = {rows: rows.at(-1) + 1, columns: columns.at(-1) + 2};
      recipe.text = Array(recipe.keisenCanvas.rows).fill('　'.repeat(Math.ceil(recipe.keisenCanvas.columns / 2))).join('\r\n');
    } else {
      recipe.text = Array(7).fill('　'.repeat(7)).join('\r\n');
      recipe.keisenCanvas = {rows:7,columns:13};
    }
    // CR-008: an optional document style, as for text and paragraphs. The sample
    // sets and verifies it on the shared horizontal base (Yu Mincho 10.5pt, A4
    // portrait) before the table is drawn; without it the sample keeps the
    // baseline's default style exactly as before.
    if (doc.style) {
      used.add('document-style');
      const {layoutPriority,...settings} = doc.style;
      variant.settings = settings; variant.layoutPriority = layoutPriority;
      variant.features = structuredClone(COLUMN_BASE_FEATURES);
    }
    // CR-009: the document font (as for text) and body paragraphs before the table.
    // A leading paragraph may wrap over several page lines and have space before and
    // after; the table starts on the page line after the last one, read at run time
    // (src/keisen.mjs). Everything must stay on the first page.
    if (doc.font) {
      used.add('document-font');
      variant.features = {...variant.features, font:{...variant.features?.font,...(doc.font.name ? {japaneseName:doc.font.name} : {}),...(doc.font.sizePt !== undefined ? {size:doc.font.sizePt,sizeUnit:3} : {})}};
    }
    if (doc.leadingParagraphs) {
      // An estimate in body lines (wrapped lines, larger sizes, spacing in mm at the
      // 10.5pt pitch of 5.93mm) refuses what clearly cannot leave the table on page 1.
      const lineWidthMm = 210 - (doc.style?.marginLeft ?? 30) - (doc.style?.marginRight ?? 30), pageLines = doc.style?.lines ?? 40;
      let estimate = recipe.keisenCanvas.rows;
      for (const [position, paragraph] of doc.leadingParagraphs.entries()) {
        const size = paragraph.sizePt ?? doc.font?.sizePt ?? 10.5, {spacing} = paragraph;
        if (spacing?.unit === 'mm' && [spacing.before, spacing.after].some(v => v > 10)) fail(sample.id, `leadingParagraphs[${position}].spacing: leading paragraph spacing in mm must be 0..10 (got ${['before','after'].filter(key => spacing[key] !== undefined).map(key => `${key} ${spacing[key]}`).join(', ')})`);
        estimate += Math.max(1, Math.ceil(paragraph.text.length * size * 25.4 / 72 / lineWidthMm)) * Math.max(1, size / 10.5);
        if (spacing) estimate += ((spacing.before ?? 0) + (spacing.after ?? 0)) * (spacing.unit === 'mm' ? 1 / 5.93 : 1 / 100);
      }
      if (estimate > pageLines) fail(sample.id, `leading paragraphs and the table need about ${Math.ceil(estimate)} lines, more than the ${pageLines} lines of the first page`);
      recipe.keisenCanvas = {...recipe.keisenCanvas, leading:doc.leadingParagraphs.map(p => ({text:p.text,...(p.sizePt !== undefined ? {size:p.sizePt} : {}),...(p.spacing ? {spacing:{before:p.spacing.before ?? 0,after:p.spacing.after ?? 0,unit:p.spacing.unit === 'mm' ? 1 : 100}} : {})}))};
      recipe.text = [...doc.leadingParagraphs.map(p => p.text), recipe.text].join('\r\n');
    }
    variant.keisenOperations = [{type:'table', rows, columns, lineType:doc.lineType??null, color:doc.color??null}];
    // Final-state merges: each requested rectangle becomes one merged cell.
    // owner is the top-left cell that a cell belongs to; for a merged cell also
    // the merge's index in the request (merge), as position is for error messages.
    const owner = Array.from({length:doc.rows}, (_, r) => Array.from({length:doc.columns}, (_, c) => ({row:r + 1, column:c + 1})));
    const merges = (doc.merges ?? []).map((merge, position) => ({...merge, position}));
    const table = `${doc.rows} rows and ${doc.columns} columns`;
    for (const merge of [...merges].sort((a, b) => a.from.row - b.from.row || a.from.column - b.from.column)) {
      const {from, to, position} = merge, where = `merges[${position}] ${mergeAt(merge)}`;
      if (to.row > doc.rows || to.column > doc.columns) fail(sample.id, `${where}: merge outside requested table of ${table}`);
      if (to.row < from.row || to.column < from.column || (to.row === from.row && to.column === from.column)) fail(sample.id, `${where}: merge needs from at the top-left and at least two cells`);
      for (let r = from.row; r <= to.row; r++) for (let c = from.column; c <= to.column; c++) {
        const covered = owner[r - 1][c - 1];
        if (covered.merge !== undefined) fail(sample.id, `${where}: merges overlap; ${cellAt({row:r, column:c})} is already in merges[${covered.merge}] ${mergeAt(merges[covered.merge])}`);
        owner[r - 1][c - 1] = {row:from.row, column:from.column, merge:position};
      }
      variant.keisenOperations.push({type:'cellMerge', from:{...from}, to:{...to}});
    }
    const cells=(doc.cells??[]).map((cell,position)=>({...cell,position})).sort((a,b)=>a.row-b.row||a.column-b.column);
    const cellWhere = cell => `cells[${cell.position}] ${cellAt(cell)}`;
    for(const [index,cell] of cells.entries()) {
      if(cell.row>doc.rows||cell.column>doc.columns)fail(sample.id,`${cellWhere(cell)}: cell outside requested table of ${table}`);
      if(index&&cells[index-1].row===cell.row&&cells[index-1].column===cell.column)fail(sample.id,`${cellWhere(cell)}: duplicate cell specification (cells[${cells[index-1].position}] has the same position)`);
      const top = owner[cell.row - 1][cell.column - 1];
      if (top.row !== cell.row || top.column !== cell.column) fail(sample.id, `${cellWhere(cell)}: a merged cell is addressed by its top-left position; this cell is inside merges[${top.merge}] ${mergeAt(merges[top.merge])}, so write ${cellAt(top)}`);
    }
    // Text after merges (capacity of the final cell), then attributes in a stable order.
    for (const cell of cells) if (cell.text !== undefined) {
      const merge = doc.merges?.find(m => m.from.row === cell.row && m.from.column === cell.column), right = merge?.to.column ?? cell.column;
      const width = columns[right] - columns[cell.column - 1], capacity = Math.min(4, width / 2 - 1);
      if (cell.text.length > capacity || /[\s\p{M}\p{C}\uD800-\uDFFF]/u.test(cell.text)) fail(sample.id, `${cellWhere(cell)}: cell text must be non-whitespace BMP characters, at most ${capacity} for a ${merge ? 'merged ' : ''}cell of width ${width} half-width columns (min(4, width/2-1)); got ${quoteValue(cell.text)}, ${characters(cell.text)}`);
      variant.keisenOperations.push({type:'tableText', cell:{row:cell.row, column:cell.column}, text:cell.text});
    }
    for (const cell of cells)
      // Final attributes use a stable order regardless of JSON key/array order.
      for(const attribute of ['alignment','textColor','bold','italic','fill','color'])if(cell.attributes?.[attribute]!==undefined)
        variant.keisenOperations.push({type:'tableAttribute',cell:{row:cell.row,column:cell.column},attribute,value:cell.attributes[attribute]});
    const ruleByRule = doc.rows > 2 || doc.columns > 2 || doc.merges !== undefined;
    if(!ruleByRule&&variant.keisenOperations.length>8)fail(sample.id,`at most seven cell texts and attributes in total for a table up to 2x2 without merges (got ${variant.keisenOperations.length - 1})`);
    if(ruleByRule&&variant.keisenOperations.length>16)fail(sample.id,`at most fifteen merges, cell texts and attributes in total (got ${variant.keisenOperations.length - 1})`);
  } else {
    used.add('plain-text');
    recipe.text = doc.text;
    // CR-001: keep the new document's style. The recipe has no defaults and the
    // variant no features, so neither the baseline nor the sample sets a style.
    if (doc.styleSource) {
      const setters = ['style','font','page','writingMode','columnFormat','pageNumber','typesetting'].filter(key => doc[key] !== undefined);
      if (setters.length) fail(sample.id,`styleSource cannot combine with ${setters.join(', ')}: each sets the document style`);
      used.add('document-style-source');
      recipe.styleSource = doc.styleSource;
      delete recipe.defaults;
      delete variant.features;
    }
    // Order: document style base (fixed font/paper) → font, paper and other
    // document overrides → range annotations (applied after the style in the macro).
    if (doc.style) {
      used.add('document-style');
      const {layoutPriority,...settings}=doc.style;
      variant.settings=settings;
      variant.layoutPriority=layoutPriority;
      variant.features=structuredClone(COLUMN_BASE_FEATURES);
    }
    if (doc.font) {
      used.add('document-font');
      variant.features.font = {...variant.features.font,...(doc.font.name ? {japaneseName:doc.font.name} : {}),
        ...(doc.font.sizePt !== undefined ? {size:doc.font.sizePt,sizeUnit:3} : {})};
    }
    if (doc.pageNumber) {
      used.add('document-page');
      variant.features.page = pageFeature(doc.pageNumber);
    }
    if (doc.typesetting) {
      used.add('document-typesetting');
      variant.features.typesetting = typesettingFeature(sample.id, doc.typesetting);
    }
    if (doc.columnFormat) {
      used.add('document-columns');
      variant.features.columns = columnFeature(doc.columnFormat);
    }
    if (doc.page) {
      used.add('document-paper');
      variant.features.paper = {name:`${doc.page.paper} 単票・${doc.page.orientation==='portrait'?'縦':'横'}方向`};
    }
    if (doc.writingMode !== undefined) {
      used.add('document-layout');
      variant.features.layout = {orientation:doc.writingMode==='vertical'?2:1};
    }
    const textParagraphs = doc.text.split(String.fromCharCode(10));
    const emptyParagraph = textParagraphs.findIndex(p => !p.length);
    if (emptyParagraph >= 0) fail(sample.id,`paragraphs separated by LF must not be empty; paragraph ${emptyParagraph} (counting from 0) is empty`);
    // CR-003: a body over 2000 characters is horizontal text proven by joined
    // lines and a paragraph walk; annotations are read back character by
    // character only in the paragraphs that hold them (src/ranges.mjs).
    const longText = doc.text.length > LONG_TEXT_THRESHOLD;
    if (longText) {
      if (doc.writingMode === 'vertical') fail(sample.id,`vertical writing requires a text of at most ${LONG_TEXT_THRESHOLD} characters`);
      try { bodyParagraphs(doc.text); } catch (error) { fail(sample.id,error.message); }
      recipe.bodyCheck = 'paragraph-ends';
    }
    // Annotations are a set of non-overlapping final attributes, not an
    // instruction sequence. Sorting makes output independent of array order.
    // position keeps the index in the request for error messages.
    const annotations = (doc.annotations ?? []).map((annotation,position)=>({...annotation,position})).sort((a,b)=>a.range.start-b.range.start);
    if (annotations.length) { recipe.targets=[]; variant.operations=[]; }
    // A multi-paragraph body without annotations still gets the per-character walk
    // (identity and paragraph ends): GetString lines cannot prove paragraph structure.
    if (!annotations.length && !longText && textParagraphs.length > 1) { recipe.targets=[{id:'body-check',kind:'text',start:0,end:1,expected:doc.text[0]}]; variant.operations=[]; }
    for (const [index, annotation] of annotations.entries()) {
      const {capability,range,parameters:p,position} = annotation;
      used.add(capability);
      checkRange(sample.id,doc.text,range,position);
      if (index && annotations[index-1].range.end > range.start) {
        const named = item => `annotations[${item.position}] (${item.capability} [${item.range.start},${item.range.end}) ${quoteValue(item.range.text)})`;
        fail(sample.id,`${named(annotation)} overlaps ${named(annotations[index-1])}; annotations must not overlap even with different capabilities`);
      }
      const target = `range-${index}`;
      recipe.targets.push({id:target,kind:'text',start:range.start,end:range.end,expected:range.text});
      if (capability === 'character-decoration' || capability === 'character-border') {
        // Final decoration state in a stable order. Ichitaro shares one
        // decoration color per character, so the same color goes on every call.
        const values = capability === 'character-border' ? {border:p.lineType} : {underline:p.underline,strikeThrough:p.strikeThrough,fill:p.fill};
        const set = Object.entries(values).filter(([,value])=>value!==undefined);
        if (!set.length) fail(sample.id,`annotations[${position}]: character-decoration requires underline, strikeThrough or fill`);
        for (const [attribute,value] of set) variant.operations.push({target,type:'character',attribute,mode:'set',value,...(p.color===undefined?{}:{color:p.color})});
        continue;
      }
      const op = {target,type:'character',attribute:REQUEST_BINDINGS[capability].attribute,mode:'set'};
      switch (capability) {
        case 'character-scaleX': op.value=p.percent; break;
        case 'character-size': op.value=p.points; break;
        case 'character-spacing': op.value=p.value; op.unit=units[p.unit]; break;
        case 'closely-spacing': break;
        case 'character-font-style': op.value=p.style; break;
        case 'character-color': op.value=p.color; break;
        case 'character-font': op.value=p.name; break;
        case 'evenly-spacing': op.value=p.width; op.unit=units[p.unit]; op.widthMode=1; break;
        case 'ruby': Object.assign(op,{reading:p.reading,placement:p.placement===undefined?null:p.placement==='below'?2:1,sizeMm:p.sizeMm??null,distanceMm:p.distanceMm??null,
          ...(p.alignment===undefined?{evenly:null,position:null}:{evenly:p.alignment==='distributed'?1:0,position:{distributed:1,left:1,center:2,right:3}[p.alignment]})}); break;
        default: fail(sample.id,`no compiler binding for ${capability}`);
      }
      variant.operations.push(op);
    }
  }
  if (!used.has(sample.feature)) fail(sample.id,`feature ${sample.feature} is not present in document`);
  const capabilities = new Map(buildCapabilities().capabilities.map(item=>[item.id,item]));
  for (const id of used) if (capabilities.get(id)?.status !== 'implemented' || !capabilities.get(id)?.requestSupported) fail(sample.id,`capability ${id} is not available to requests`);
  recipe.samples.push(variant);
  // A control reopens the same baseline JTD and saves it unchanged under a new
  // name, so save-to-save byte noise can be measured against the requested sample.
  if (sample.control) {
    if (sample.id === 'control') fail(sample.id,'a sample with control:true cannot itself be named control');
    recipe.samples.push({id:'control',settings:{}});
  }
  // Reuse execution validators for bounds, minimum target lengths and
  // combinations. Validation and compilation therefore have identical gates.
  try { expandExperiment(recipe); } catch (error) { fail(sample.id,error.message); }
  return {sampleId:sample.id,recipeFile:`${sample.id}.recipe.json`,outputSampleId:sample.id,
    baselineSampleId:'baseline',...(sample.control?{controlSampleId:'control'}:{}),capabilities:[...used],recipe};
}

const MAX_JOBS = 200;
export function compileCatalog(input) {
  assertJsonData(input);
  validateSchema(input,SAMPLE_SCHEMA);
  const catalog = structuredClone(input);
  const ids = new Set();
  for (const sample of catalog.samples) {
    if (reserved.test(sample.id) || ids.has(sample.id)) fail(sample.id,'duplicate or reserved sample id');
    ids.add(sample.id);
  }
  if (reserved.test(catalog.id)) fail('catalog.id','reserved catalog id');
  for (const sample of catalog.samples) for (const related of sample.relatedSamples ?? []) {
    if (related === sample.id || !ids.has(related)) fail(sample.id,`relatedSamples must refer to a different sample in this catalog: ${related}`);
  }
  // repeat:n runs the same request n times as separate jobs (<id>-r1..rn), each
  // with its own baseline, to observe run-to-run variation.
  const jobs = catalog.samples.flatMap(sample => {
    const job = compileSample(sample), count = sample.repeat ?? 1;
    if (count === 1) return [job];
    return Array.from({length:count},(_,k)=>({...job,sampleId:`${sample.id}-r${k+1}`,recipeFile:`${sample.id}-r${k+1}.recipe.json`,requestSampleId:sample.id,repeat:k+1,recipe:structuredClone(job.recipe)}));
  });
  if (jobs.length > MAX_JOBS) fail('catalog',`expands to ${jobs.length} jobs; at most ${MAX_JOBS} (repeats included)`);
  return {schemaVersion:1,compilerVersion:1,applicationVersion:APPLICATION_VERSION,catalog,jobs};
}

export function validateCatalog(input) {
  const compiled = compileCatalog(input);
  return {ok:true,schemaVersion:input.schemaVersion,catalogId:input.id,sampleCount:compiled.jobs.length,
    executionSampleCount:compiled.jobs.reduce((n,job)=>n+(job.controlSampleId?3:2),0),capabilities:[...new Set(compiled.jobs.flatMap(job=>job.capabilities))],
    expectedEvaluation:'not-performed',prerequisiteEvaluation:'not-performed'};
}

export async function loadCatalog(filename) {
  try { return JSON.parse((await fs.readFile(filename,'utf8')).replace(/^\uFEFF/,'')); }
  catch (error) { throw Object.assign(new Error(`Cannot read Sample Catalog: ${error.message}`),{code:'ERR_SAMPLE_INPUT'}); }
}

const json = value => JSON.stringify(value,null,2)+'\n';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export async function writeCompilation(input,directory) {
  const compiled = compileCatalog(input); // Complete validation before any writes.
  const destination = path.resolve(directory);
  await fs.mkdir(destination); // Exclusive destination; never overwrite earlier work.
  const requestBytes = json(compiled.catalog);
  await fs.writeFile(path.join(destination,'request.json'),requestBytes,{flag:'wx'});
  const jobs=[];
  for (const {recipe,...job} of compiled.jobs) {
    const bytes=json(recipe);
    await fs.writeFile(path.join(destination,job.recipeFile),bytes,{flag:'wx'});
    jobs.push({...job,recipeSha256:hash(bytes)});
  }
  const manifest={schemaVersion:compiled.schemaVersion,compilerVersion:compiled.compilerVersion,
    applicationVersion:compiled.applicationVersion,catalogId:compiled.catalog.id,
    requestFile:'request.json',requestSha256:hash(requestBytes),jobs};
  await fs.writeFile(path.join(destination,'compilation.json'),json(manifest),{flag:'wx'});
  return {ok:true,directory:destination,manifestPath:path.join(destination,'compilation.json'),...validateCatalog(input)};
}
