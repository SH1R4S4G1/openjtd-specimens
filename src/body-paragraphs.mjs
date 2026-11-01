// CR-003. Paragraph structure of a long plain body without the per-character
// walk (probes tmp/probe-paragraph-ends-v1.mjs and -v2.mjs on 2026-10-16):
// NextParagraph(1) from each paragraph start reaches the next start; from there
// CursorLeft(1) is the paragraph end (empty, type 10) and once more the last
// character of the paragraph. After the last paragraph NextParagraph(1) stays on
// an empty type-0 slot whose left neighbour is the document end (empty, type 0).
// Walking 300 paragraphs this way took about 8s; JumpStart+NextParagraph(k)
// for every k grew with k and took over 300s, so the walk is sequential.
export const LONG_TEXT_THRESHOLD = 2000;
export const MAX_LONG_TEXT = 60000;
export const MAX_BODY_PARAGRAPHS = 1000;
const SLOTS = ['start', 'next', 'left1', 'left2'];

export function bodyParagraphs(text) {
  const paragraphs = text.replace(/\r\n|\r/g, '\n').split('\n');
  if (paragraphs.length > MAX_BODY_PARAGRAPHS || paragraphs.some(p => !p.length)) throw new Error(`A long body needs 1..${MAX_BODY_PARAGRAPHS} nonempty paragraphs`);
  return paragraphs;
}

export function bodyParagraphsMacro({ text, q }) {
  const count = bodyParagraphs(text).length;
  const record = (stage, slot) => `%result.LinePrint(${q(`bodyParagraph.${stage}.`)} & %bk & ${q(`.${slot}=`)} & GetCharacter() & "/" & GetCharacterType() & "/" & GetPage() & "/" & GetRow() & "/" & GetColumn())`;
  return {
    snapshot: stage => ['CancelMode()', 'CancelAllRange()', 'JumpStart()', '%bk=0', 'do', `if %bk >= ${count} then`, 'exit do', 'end if',
      record(stage, 'start'), 'NextParagraph(1)', record(stage, 'next'), 'CursorLeft(1)', record(stage, 'left1'), 'CursorLeft(1)', record(stage, 'left2'),
      'NextParagraph(1)', '%bk=%bk+1', 'loop', 'CancelAllRange()'],
  };
}

// value: <character>/<type>/<page>/<row>/<column>; the character may itself be "/".
function slot(value) {
  const match = /^(.*)\/(-?\d+)\/(\d+)\/(\d+)\/(\d+)$/su.exec(value ?? '');
  return match ? { character: match[1], type: Number(match[2]), position: [Number(match[3]), Number(match[4]), Number(match[5])] } : null;
}

/**
 * Compares the walk with the requested paragraphs and checks that the reopened
 * GetString(1) lines split exactly at every requested paragraph end. Together
 * with the joined-character comparison done by the caller, a missing, extra or
 * moved paragraph break fails unless the neighbouring characters coincide.
 */
export function verifyBodyParagraphs(meta, { text, body, stages = ['before-save', 'reopened'] }) {
  const paragraphs = bodyParagraphs(text), differences = [], snapshots = {};
  for (const stage of stages) {
    const observed = [];
    for (const [p, paragraph] of paragraphs.entries()) {
      const last = p === paragraphs.length - 1;
      const slots = Object.fromEntries(SLOTS.map(name => [name, slot(meta[`bodyParagraph.${stage}.${p}.${name}`])]));
      const fail = (field, expected, actual) => differences.push({ phase: stage, field: `bodyParagraph.${p}.${field}`, expected, actual });
      if (SLOTS.some(name => !slots[name])) { fail('readback', 'four slots', SLOTS.filter(name => !slots[name])); continue; }
      observed.push([slots.start.character, slots.left2.character, slots.left1.type]);
      if (slots.start.character !== paragraph[0]) fail('first', paragraph[0], slots.start.character);
      if (slots.left2.character !== paragraph.at(-1)) fail('last', paragraph.at(-1), slots.left2.character);
      if (slots.left1.character !== '' || slots.left1.type !== (last ? 0 : 10)) fail('end', last ? 'document end (type 0)' : 'paragraph end (type 10)', `${slots.left1.character}/${slots.left1.type}`);
      if (last ? slots.next.character !== '' || slots.next.type !== 0 : slots.next.character !== paragraphs[p + 1][0]) fail('next', last ? 'no further paragraph' : paragraphs[p + 1][0], `${slots.next.character}/${slots.next.type}`);
    }
    snapshots[stage] = observed;
  }
  for (const key of Object.keys(meta)) if (key.startsWith('bodyParagraph.')) delete meta[key];
  // Every requested paragraph is a run of whole physical lines.
  const lines = body.split('\n');
  let line = 0;
  for (const [p, paragraph] of paragraphs.entries()) {
    let joined = '';
    while (joined.length < paragraph.length && line < lines.length) joined += lines[line++];
    if (joined !== paragraph) { differences.push({ phase: 'body', field: `bodyParagraph.${p}.lines`, expected: paragraph.length, actual: joined.length }); break; }
  }
  if (line !== lines.length && !differences.some(d => d.phase === 'body')) differences.push({ phase: 'body', field: 'bodyParagraph.lines', expected: line, actual: lines.length });
  return { snapshots, differences, proof: { version: 1, passed: !differences.length, reopened: stages.includes('reopened') && !differences.some(d => d.phase === 'reopened'), paragraphs: paragraphs.length,
    checks: ['joined GetString(1) characters equal the requested text without paragraph breaks', 'each requested paragraph is a run of whole GetString(1) lines', 'NextParagraph walk: first and last character and the type-10 end of every paragraph, and no paragraph after the last'],
    limitations: ['Characters are not read one by one; a moved break between equal neighbouring characters is not detected. Attributes and positions are not read.'] } };
}
