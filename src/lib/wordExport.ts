// Phase P1, extended in P5: the student's assembled thesis as an editable Word file (.docx), built in the browser.
// Supervisor never adds thesis text: every paragraph, table, caption, equation and reference comes from what the
// student wrote on the Document page. Empty parts are marked as not written. The student's working notes from each
// step, and the experiment runs they recorded, go in a clearly separated appendix. Notes from Supervisor use their own
// grey italic style and start with "Supervisor note", so the student can find and delete them before submission.
//
// What the student types is plain text, so a few plain-text conventions carry the academic structure (P5):
//   ## Heading, ### Subheading             sections and subsections, numbered 1.1 and 1.1.1 unless already numbered
//   Table: caption, then | a | b | rows    a table, with an optional |---| line under the header row
//   [Figure: caption] or Figure: caption   a numbered caption and a marked place for the image (images are not stored)
//   $$ x = y $$, or lines between $$       a numbered equation, kept exactly as typed in a Word equation
//   - item, * item, 1. item                list items, with the student's own markers
//   **bold**, *italic*                     inline emphasis
// Lines in References become reference entries with a hanging indent, exactly as typed, never reformatted or completed.

import { buildBibliography, CITE, libraryOf, STYLE_LABELS, type Seg } from './library';
import { STEPS, stepState, type PathState } from './path';
import { runToText } from './runs';
import { REQUIRED_EXTRAS, structureOf } from './structures';

export type Block =
  | { kind: 'title' | 'meta' | 'note' | 'p' | 'ref' | 'li'; text: string }
  | { kind: 'h1'; text: string; pageBreak: boolean; number?: number }
  | { kind: 'h2' | 'h3'; text: string; number?: string }
  | { kind: 'table'; rows: string[][]; header: boolean; caption?: string; number?: string; padded?: boolean }
  | { kind: 'figure'; caption: string; number?: string }
  | { kind: 'equation'; source: string; number?: string }
  | { kind: 'bib'; label: string; segs: Seg[] }
  | { kind: 'toc' };

/** Characters Word cannot store (XML 1.0), and lone surrogates, are removed. Everything else is kept as typed. */
export function cleanText(t: string): string {
  // A plain loop rather than a look-behind pattern, which older Safari versions cannot parse.
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = t.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += t[i] + t[i + 1];
        i++;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff) continue;
    out += t[i];
  }
  return out;
}

/** Parts outside the numbered chapters. */
export const FRONT_PARTS = new Set(['abstract']);
export const BACK_PARTS = new Set(['references', 'appendices']);

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*(:?-{2,}:?\s*)?\|?\s*$/;
const TABLE_CAPTION = /^\s*Table\s*:\s*(.+)$/i;
const FIGURE = /^\s*(?:\[\s*Figure\s*:\s*(.+?)\s*\]|Figure\s*:\s*(.+))\s*$/i;
const LIST = /^\s*([-*•]|\d{1,3}[.)])\s+(.+)$/;
const ALREADY_NUMBERED = /^\s*(\d+(\.\d+)*|[A-Z]\.\d+(\.\d+)*)[.)]?\s/;
const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/**
 * The student's text for one part, as blocks. Each non-empty line is a paragraph unless it follows one of the
 * conventions above. Nothing is added: a line that does not fully match a convention stays a plain paragraph.
 */
export function textBlocks(text: string, opts: { references?: boolean } = {}): Block[] {
  const out: Block[] = [];
  const lines = cleanText(text).replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line.trim()) continue;
    const h = /^\s*(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      out.push({ kind: h[1].length === 3 ? 'h3' : 'h2', text: h[2].trim() });
      continue;
    }
    if (opts.references) {
      out.push({ kind: 'ref', text: line.trim() });
      continue;
    }
    // A table: optional "Table: caption" line, then rows that start and end with "|".
    const cap = TABLE_CAPTION.exec(line);
    const start = cap ? i + 1 : i;
    if (TABLE_ROW.test(lines[start] ?? '') && !TABLE_RULE.test(lines[start] ?? '')) {
      const rows: string[][] = [];
      let header = false;
      let j = start;
      for (; j < lines.length && TABLE_ROW.test(lines[j]); j++) {
        if (TABLE_RULE.test(lines[j])) {
          if (rows.length === 1) header = true;
          continue;
        }
        rows.push(cells(lines[j]));
      }
      const width = Math.max(...rows.map((r) => r.length));
      const padded = rows.some((r) => r.length !== width);
      out.push({ kind: 'table', rows: rows.map((r) => [...r, ...Array(width - r.length).fill('')]), header, ...(cap ? { caption: cap[1].trim() } : {}), ...(padded ? { padded } : {}) });
      i = j - 1;
      continue;
    }
    const fig = FIGURE.exec(line);
    if (fig) {
      out.push({ kind: 'figure', caption: (fig[1] ?? fig[2]).trim() });
      continue;
    }
    // An equation on one line, $$ … $$, or on the lines between a "$$" line and the next "$$" line.
    const one = /^\s*\$\$(.+)\$\$\s*$/.exec(line);
    if (one && one[1].trim()) {
      out.push({ kind: 'equation', source: one[1].trim() });
      continue;
    }
    if (line.trim() === '$$') {
      const end = lines.findIndex((l, k) => k > i && l.trim() === '$$');
      if (end > i + 1) {
        out.push({ kind: 'equation', source: lines.slice(i + 1, end).map((l) => l.trim()).filter(Boolean).join(' ') });
        i = end;
        continue;
      }
    }
    const li = LIST.exec(line);
    if (li) {
      out.push({ kind: 'li', text: line.trim() });
      continue;
    }
    out.push({ kind: 'p', text: line });
  }
  return out;
}

/** Numbers chapters' sections, tables, figures and equations, e.g. 2.1, Table 2.1, (2.1). Headings already numbered are kept. */
function numberPart(blocks: Block[], prefix: string | null): Block[] {
  let s = 0;
  let ss = 0;
  let t = 0;
  let f = 0;
  let e = 0;
  const n = (k: number) => (prefix ? `${prefix}.${k}` : String(k));
  return blocks.map((b) => {
    if (b.kind === 'h2') {
      s++;
      ss = 0;
      return prefix && prefix !== 'A' && !ALREADY_NUMBERED.test(b.text) ? { ...b, number: n(s) } : b;
    }
    if (b.kind === 'h3') {
      ss++;
      return prefix && prefix !== 'A' && !ALREADY_NUMBERED.test(b.text) ? { ...b, number: `${n(s)}.${ss}` } : b;
    }
    if (b.kind === 'table') return { ...b, number: n(++t) };
    if (b.kind === 'figure') return { ...b, number: n(++f) };
    if (b.kind === 'equation') return { ...b, number: n(++e) };
    return b;
  });
}

/** Superscript markers inside paragraph text (private-use characters, never typed by students). */
export const SUP_OPEN = '\uE000';
export const SUP_CLOSE = '\uE001';

/** The bibliography for this thesis, when it cites at least one reference of its library. */
export function bibliographyFor(p: PathState) {
  const lib = libraryOf(p);
  if (!lib.refs.length) return null;
  const parts = structureOf(p).parts.filter((x) => x.id !== 'references').map((x) => p.parts?.[x.id] ?? '');
  const bib = buildBibliography(lib, parts, lib.style ?? 'apa7');
  return bib.cited.length || bib.missingKeys.length ? bib : null;
}

export function renderCitations(text: string, bib: NonNullable<ReturnType<typeof bibliographyFor>>) {
  return text.replace(CITE, (m) => {
    const r = bib.render(m);
    return r.superscript ? `${SUP_OPEN}${r.text}${SUP_CLOSE}` : r.text;
  });
}

const dateText = (iso: string) => {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/** Everything the Word file holds, in order. Pure, so it can be tested without a browser. */
export function exportBlocks(p: PathState, now = new Date()): Block[] {
  const structure = structureOf(p);
  const title = (p.title ?? '').trim() || p.topic.trim();
  const blocks: Block[] = [{ kind: 'title', text: cleanText(title || 'Untitled thesis') }];
  if (!title) blocks.push({ kind: 'note', text: 'No title is recorded in Supervisor yet.' });
  if (p.topic.trim() && p.topic.trim() !== title) blocks.push({ kind: 'meta', text: cleanText(`Research topic: ${p.topic.trim()}`) });
  if (p.discipline.trim()) blocks.push({ kind: 'meta', text: cleanText(`Discipline: ${p.discipline.trim()}`) });
  if (p.defenseDate) blocks.push({ kind: 'meta', text: `Planned defense date: ${dateText(p.defenseDate)}` });
  blocks.push({ kind: 'meta', text: `Thesis structure: ${structure.name}` });
  blocks.push({ kind: 'meta', text: `Exported from Supervisor on ${dateText(now.toISOString())}` });
  blocks.push(
    { kind: 'note', text: 'Supervisor assembled this file from the text you wrote on the Document page. It added no thesis text, sources, figures, equations or results. Paragraphs in grey italics that start with “Supervisor note”, like this one, are notes from Supervisor: delete them before you submit.' },
    { kind: 'note', text: `Next, in Word: apply your university’s template, insert your figures in the marked places, then add what Supervisor does not hold: ${REQUIRED_EXTRAS.join(', ').toLowerCase()}. Confirm the exact order and format with your school’s rules.` },
    { kind: 'toc' },
  );
  // Phase P6: citations [@key] become in-text citations in the chosen style, and References lists the cited records.
  const bib = bibliographyFor(p);
  let chapter = 0;
  for (const part of structure.parts) {
    const front = FRONT_PARTS.has(part.id);
    const back = BACK_PARTS.has(part.id);
    const number = front || back ? undefined : ++chapter;
    const raw = p.parts?.[part.id] ?? '';
    const text = bib && part.id !== 'references' ? renderCitations(raw, bib) : raw;
    // Appendices that are empty are left out: they are optional. Every other part is always present.
    if (part.id === 'appendices' && !text.trim()) continue;
    blocks.push({ kind: 'h1', text: part.title, pageBreak: true, ...(number ? { number } : {}) });
    if (part.id === 'references' && bib) {
      blocks.push(...bib.entries.map((e) => ({ kind: 'bib', label: e.label, segs: e.segs }) as Block));
      if (bib.missingKeys.length) blocks.push({ kind: 'note', text: `These citations in your text match no reference in your library, so they are shown as typed: ${bib.missingKeys.map((k) => `[@${k}]`).join(', ')}. Add the references or correct the keys.` });
      const typed = textBlocks(raw, { references: true });
      if (typed.length) blocks.push({ kind: 'note', text: 'The entries below were typed in References and are not linked to your library. They are kept exactly as typed: check that none repeats an entry above, and that they follow the same style.' }, ...typed);
      continue;
    }
    const body = numberPart(textBlocks(text, { references: part.id === 'references' }), number ? String(number) : part.id === 'appendices' ? 'A' : null);
    blocks.push(...(body.length ? body : [{ kind: 'note', text: 'Not written yet in Supervisor.' } as Block]));
  }
  // The student's working notes and recorded runs: source material, never thesis text.
  const notes = STEPS.filter((s) => {
    const w = stepState(p, s.id).work.trim();
    return w && w !== (s.workTemplate ?? '').trim();
  });
  const runs = p.runs ?? [];
  if (notes.length || runs.length) {
    blocks.push(
      { kind: 'h1', text: 'Appendix: research notes from Supervisor', pageBreak: true },
      { kind: 'note', text: 'Your working notes from each step and the experiment runs you recorded, as you entered them. They are source material, not thesis text. Delete this appendix before you submit.' },
    );
    for (const s of notes) {
      const st = stepState(p, s.id).status;
      blocks.push({ kind: 'h2', text: `${s.title}${st === 'done' ? '' : st === 'skipped' ? ' (step set aside)' : ' (step in progress)'}` });
      // Notes are shown as typed: "#" lines stay text here, so they cannot become thesis headings.
      for (const line of cleanText(stepState(p, s.id).work).replace(/\r\n?/g, '\n').split('\n')) if (line.trim()) blocks.push({ kind: 'p', text: line.trimEnd() });
    }
    if (runs.length) {
      blocks.push({ kind: 'h2', text: 'Experiment runs you recorded' });
      for (const r of runs) {
        const [head, ...rest] = runToText(r, 'en').split('\n');
        blocks.push({ kind: 'h3', text: cleanText(head) });
        for (const line of rest) blocks.push({ kind: 'p', text: cleanText(line) });
      }
    }
  }
  return blocks;
}

export type ExportSummary = {
  chapters: number;
  sections: number;
  paragraphs: number;
  tables: number;
  paddedTables: number;
  figures: number;
  equations: number;
  references: number;
  appendices: boolean;
  citations: number;
  citedReferences: number;
  style?: string;
  emptyParts: string[];
  limitations: string[];
};

/** What the Word file holds, and what it cannot hold faithfully, so the page can say so before and after download. */
export function exportSummary(p: PathState): ExportSummary {
  const b = exportBlocks(p);
  const structure = structureOf(p);
  const n = (k: Block['kind']) => b.filter((x) => x.kind === k).length;
  const tables = b.filter((x): x is Extract<Block, { kind: 'table' }> => x.kind === 'table');
  const s: ExportSummary = {
    chapters: b.filter((x) => x.kind === 'h1' && x.number).length,
    sections: n('h2') + n('h3'),
    paragraphs: n('p') + n('li'),
    tables: tables.length,
    paddedTables: tables.filter((t) => t.padded).length,
    figures: n('figure'),
    equations: n('equation'),
    references: n('ref'),
    appendices: !!(p.parts?.appendices ?? '').trim(),
    citations: structure.parts.filter((x) => x.id !== 'references').reduce((k, x) => k + [...(p.parts?.[x.id] ?? '').matchAll(CITE)].length, 0),
    citedReferences: 0,
    emptyParts: structure.parts.filter((x) => x.id !== 'appendices' && !(p.parts?.[x.id] ?? '').trim()).map((x) => x.title),
    limitations: [],
  };
  if (s.figures) s.limitations.push(`Supervisor does not store images: each of your ${s.figures} figure${s.figures === 1 ? '' : 's'} has its caption and a marked place, and you insert the image in Word.`);
  if (s.equations) s.limitations.push(`Your ${s.equations} equation${s.equations === 1 ? ' is' : 's are'} kept exactly as you typed ${s.equations === 1 ? 'it' : 'them'}, inside a Word equation. If you typed LaTeX, convert it in Word (Equation, then Convert, Professional), and check the result.`);
  if (s.paddedTables) s.limitations.push(`${s.paddedTables} table${s.paddedTables === 1 ? ' has' : 's have'} rows with fewer cells than others: empty cells were added at the end of those rows. Nothing was moved or filled in.`);
  const bib = bibliographyFor(p);
  const lib = libraryOf(p);
  if (bib) {
    s.citedReferences = bib.cited.length;
    s.references = bib.entries.length + n('ref');
    s.style = STYLE_LABELS[bib.style];
    if (bib.missingKeys.length) s.limitations.push(`${bib.missingKeys.length} citation key${bib.missingKeys.length === 1 ? ' matches' : 's match'} no reference in your library (${bib.missingKeys.map((k) => `[@${k}]`).join(', ')}): ${bib.missingKeys.length === 1 ? 'it stays' : 'they stay'} as typed in the Word file.`);
    if (bib.uncited.length) s.limitations.push(`${bib.uncited.length} reference${bib.uncited.length === 1 ? ' in your library is' : 's in your library are'} not cited in your text, so ${bib.uncited.length === 1 ? 'it is' : 'they are'} not in the reference list.`);
    if (n('ref')) s.limitations.push(`${n('ref')} reference${n('ref') === 1 ? ' was' : 's were'} typed in References and ${n('ref') === 1 ? 'is' : 'are'} not linked to your library: ${n('ref') === 1 ? 'it is' : 'they are'} kept as typed after the formatted list.`);
    if (bib.style === 'gbt7714') s.limitations.push('GB/T 7714 follows the 2015 rules. If your university requires the 2025 edition, check the reference list against it.');
    s.limitations.push('Citations and the reference list are text in the Word file, not Zotero, EndNote or Word citation fields: add or move citations in Supervisor, then export again.');
  } else {
    if (lib.refs.length) s.limitations.push(`Your library has ${lib.refs.length} reference${lib.refs.length === 1 ? '' : 's'}, but your text cites none, so References keeps what you typed there. Cite with [@key] to build the list from your library.`);
    s.limitations.push('Citations and references are exported exactly as you typed them. They are plain text, not linked to Zotero, EndNote or Word’s citation tool, and Supervisor does not check or complete them.');
  }
  s.limitations.push('Lists of figures and tables, the cover and your university’s exact template are added in Word.');
  return s;
}

/** A file name with the title in plain letters, for example "thesis-lanterns-in-deep-learning-2026-11-10.docx". */
export function exportFileName(p: PathState, now = new Date()) {
  const slug = ((p.title ?? '').trim() || p.topic.trim())
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `thesis${slug ? `-${slug}` : ''}-${now.toISOString().slice(0, 10)}.docx`;
}

// ---------- Word file (Office Open XML) ----------

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** One run of text; tabs become Word tabs, spaces are preserved. */
const textRuns = (t: string, rPr = '') =>
  t
    .split('\t')
    .map((part, i) => `${i ? '<w:r><w:tab/></w:r>' : ''}${part ? `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(part)}</w:t></w:r>` : ''}`)
    .join('');

/** **bold** and *italic*, only when the markers are paired around text. Anything else stays as typed. */
export function inlineRuns(t: string): string {
  if (t.includes(SUP_OPEN)) {
    return t
      .split(new RegExp(`${SUP_OPEN}([^${SUP_CLOSE}]*)${SUP_CLOSE}`))
      .map((part, i) => (i % 2 ? textRuns(part, '<w:vertAlign w:val="superscript"/>') : inlineRuns(part)))
      .join('');
  }
  let out = '';
  const re = /\*\*(\S(?:[^*]*?\S)?)\*\*|\*(\S(?:[^*]*?\S)?)\*/g; // no look-behind: older Safari cannot parse it
  let last = 0;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    out += textRuns(t.slice(last, m.index));
    out += m[1] !== undefined ? textRuns(m[1], '<w:b/><w:bCs/>') : textRuns(m[2], '<w:i/><w:iCs/>');
    last = m.index + m[0].length;
  }
  return out + textRuns(t.slice(last));
}

const para = (style: string | null, inner: string, extra = '') => `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : ''}${inner}</w:p>`;
const NOTE_LABEL = '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Supervisor note: </w:t></w:r>';
const note = (text: string) => para('SupervisorNote', NOTE_LABEL + textRuns(text));
const heading = (style: string, text: string, number?: string, extra = '') => para(style, textRuns(number ? `${number} ${text}` : text), extra);

const CELL_BORDER = (bottom: boolean) => (bottom ? '<w:tcBorders><w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/></w:tcBorders>' : '');
function tableXml(b: Extract<Block, { kind: 'table' }>) {
  const cols = b.rows[0]?.length ?? 1;
  const caption = para('Caption', textRuns(`Table ${b.number ?? ''}${b.caption ? ` ${b.caption}` : ''}`.replace(/\s+$/, '')), '<w:keepNext/>');
  const grid = `<w:tblGrid>${Array(cols).fill(`<w:gridCol w:w="${Math.floor(9026 / cols)}"/>`).join('')}</w:tblGrid>`;
  const rows = b.rows
    .map((r, i) => {
      const head = b.header && i === 0;
      return `<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${r
        .map((c) => `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9026 / cols)}" w:type="dxa"/>${CELL_BORDER(head)}</w:tcPr>${para('TableText', head ? textRuns(c, '<w:b/><w:bCs/>') : inlineRuns(c))}</w:tc>`)
        .join('')}</w:tr>`;
    })
    .join('');
  // A three-line table, the usual academic style: rules above, below the header row, and at the end.
  const tbl = `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:jc w:val="center"/><w:tblBorders><w:top w:val="single" w:sz="12" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="12" w:space="0" w:color="000000"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>${grid}${rows}</w:tbl>`;
  return caption + tbl + para(null, '', '<w:spacing w:after="0"/>');
}

function blockXml(b: Block): string {
  switch (b.kind) {
    case 'title': return para('Title', textRuns(b.text));
    case 'meta': return para('Subtitle', textRuns(b.text));
    case 'note': return note(b.text);
    case 'p': return para('BodyText', inlineRuns(b.text));
    case 'li': return para('ListText', inlineRuns(b.text));
    case 'ref': return para('Reference', textRuns(b.text));
    case 'bib': return para('Reference', (b.label ? textRuns(`${b.label} `) : '') + b.segs.map((x) => textRuns(x.text, x.italic ? '<w:i/><w:iCs/>' : '')).join(''));
    case 'h1': return heading('Heading1', b.text, b.number ? `Chapter ${b.number}` : undefined, b.pageBreak ? '<w:pageBreakBefore/>' : '');
    case 'h2': return heading('Heading2', b.text, b.number);
    case 'h3': return heading('Heading3', b.text, b.number);
    case 'table': return tableXml(b);
    case 'figure':
      return (
        para('FigurePlace', NOTE_LABEL + textRuns(`insert Figure ${b.number ?? ''} here. Supervisor does not store images.`), '<w:keepNext/>') +
        para('Caption', textRuns(`Figure ${b.number ?? ''} ${b.caption}`))
      );
    case 'equation':
      // The source is kept exactly as typed inside a Word equation, centred, with its number on the right.
      return para('Equation', `<w:r><w:tab/></w:r><m:oMath><m:r><m:t xml:space="preserve">${esc(b.source)}</m:t></m:r></m:oMath><w:r><w:tab/></w:r>${textRuns(b.number ? `(${b.number})` : '')}`);
    case 'toc':
      return (
        para('TOCHeading', textRuns('Contents'), '<w:pageBreakBefore/>') +
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t xml:space="preserve">In Word, right-click here and choose Update Field to build the table of contents. In LibreOffice, use Tools, Update, Update All.</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
      );
  }
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';

export function documentXml(blocks: Block[]) {
  // The title page has no page number; every other page is numbered in the footer.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>${blocks.map(blockXml).join('')}<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:titlePg/></w:sectPr></w:body></w:document>`;
}

const FOOTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-GB" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="480"/><w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="ListText"><w:name w:val="List text"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Reference"><w:name w:val="Reference entry"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="480" w:hanging="480"/><w:jc w:val="left"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:spacing w:before="120" w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="TableText"><w:name w:val="Table text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Equation"><w:name w:val="Equation"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4513"/><w:tab w:val="right" w:pos="9026"/></w:tabs><w:spacing w:before="120" w:after="120"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="FigurePlace"><w:name w:val="Figure place"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:top w:val="dashed" w:sz="6" w:space="12" w:color="808080"/><w:left w:val="dashed" w:sz="6" w:space="12" w:color="808080"/><w:bottom w:val="dashed" w:sz="6" w:space="12" w:color="808080"/><w:right w:val="dashed" w:sz="6" w:space="12" w:color="808080"/></w:pBdr><w:spacing w:before="360" w:after="360"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="2400" w:after="480"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="360"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="SupervisorNote"><w:name w:val="Supervisor note"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="595959"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
</w:styles>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;
const APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Supervisor</Application></Properties>`;
/** Only the title, as the file property: no name, e-mail or account detail. */
const core = (title: string, now: Date) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`;

/** The .docx file itself. JSZip is loaded only when the student asks for the file. */
export async function buildThesisDocx(p: PathState, now = new Date()): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip');
  const blocks = exportBlocks(p, now);
  const title = blocks[0].kind === 'title' ? blocks[0].text : 'Thesis';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('word/document.xml', documentXml(blocks));
  zip.file('word/styles.xml', STYLES);
  zip.file('word/footer1.xml', FOOTER);
  zip.file('word/_rels/document.xml.rels', DOC_RELS);
  zip.file('docProps/core.xml', core(title, now));
  zip.file('docProps/app.xml', APP);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
