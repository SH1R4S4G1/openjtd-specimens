// Page count of a PDF written by Ichitaro (SaveDocument format 23). Ichitaro
// writes uncompressed page objects, so the /Type /Page dictionaries can be
// counted in the bytes. With object streams (compressed objects) or when the
// count disagrees with the page tree's /Count, the count is not reported.
export function pdfPageCount(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  const method = 'count of /Type /Page objects, checked against the largest page tree /Count';
  if (/\/Type\s*\/ObjStm\b/.test(text)) return { pages: null, pagesMethod: 'not counted: the PDF has object streams' };
  const pages = (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  const counts = [...text.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)].map(match => Number(match[1] ?? match[2]));
  if (!pages || (counts.length && Math.max(...counts) !== pages)) return { pages: null, pagesMethod: `not counted: ${pages} page objects, page tree /Count ${counts.join(',') || 'none'}` };
  return { pages, pagesMethod: method };
}
