// Phase P1: the student's assembled thesis as an editable Word file (.docx), built in the browser.
// Supervisor never adds thesis text: every paragraph of the thesis comes from what the student wrote on the Document
// page. Empty parts are marked as not written. The student's working notes from each step, and the experiment runs
// they recorded, go in a clearly separated appendix. Notes from Supervisor use their own grey italic style, so the
// student can find and delete them before submission.
import { STEPS, stepState, type PathState } from './path';
import { runToText } from './runs';
import { REQUIRED_EXTRAS, structureOf } from './structures';

export type Block =
  | { kind: 'title' | 'meta' | 'note' | 'p' | 'h2' | 'h3'; text: string }
  | { kind: 'h1'; text: string; pageBreak: boolean }
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

/**
 * The student's text for one part, as paragraphs. Each non-empty line is a paragraph. A line starting with "## " or
 * "### " is a subsection heading ("# " counts as "## ", since the part itself is the chapter heading).
 */
export function textBlocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of cleanText(text).replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const h = /^\s*(#{1,3})\s+(.+)$/.exec(line);
    if (h) out.push({ kind: h[1].length === 3 ? 'h3' : 'h2', text: h[2].trim() });
    else out.push({ kind: 'p', text: line });
  }
  return out;
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
    { kind: 'note', text: 'Supervisor assembled this file from the text you wrote on the Document page. It added no thesis text, sources or results. Paragraphs in grey italics, like this one, are notes from Supervisor: delete them before you submit.' },
    { kind: 'note', text: `Next, in Word: apply your university’s template, then add what Supervisor does not hold: ${REQUIRED_EXTRAS.join(', ').toLowerCase()}, figures, tables and equations. Confirm the exact order and format with your school’s rules.` },
    { kind: 'toc' },
  );
  for (const part of structure.parts) {
    blocks.push({ kind: 'h1', text: part.title, pageBreak: true });
    const body = textBlocks(p.parts?.[part.id] ?? '');
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
const runs = (t: string) =>
  t
    .split('\t')
    .map((part, i) => `${i ? '<w:r><w:tab/></w:r>' : ''}${part ? `<w:r><w:t xml:space="preserve">${esc(part)}</w:t></w:r>` : ''}`)
    .join('');
const para = (style: string | null, text: string, extra = '') => `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : ''}${runs(text)}</w:p>`;

function blockXml(b: Block): string {
  switch (b.kind) {
    case 'title': return para('Title', b.text);
    case 'meta': return para('Subtitle', b.text);
    case 'note': return para('SupervisorNote', b.text);
    case 'p': return para(null, b.text);
    case 'h1': return para('Heading1', b.text, b.pageBreak ? '<w:pageBreakBefore/>' : '');
    case 'h2': return para('Heading2', b.text);
    case 'h3': return para('Heading3', b.text);
    case 'toc':
      return (
        para('TOCHeading', 'Contents', '<w:pageBreakBefore/>') +
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        '<w:r><w:t xml:space="preserve">In Word, right-click here and choose Update Field to build the table of contents. In LibreOffice, use Tools, Update, Update All.</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
      );
  }
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

export function documentXml(blocks: Block[]) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>${blocks.map(blockXml).join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="2400" w:after="480"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="SupervisorNote"><w:name w:val="Supervisor note"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="595959"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
</w:styles>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
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
  zip.file('word/_rels/document.xml.rels', DOC_RELS);
  zip.file('docProps/core.xml', core(title, now));
  zip.file('docProps/app.xml', APP);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
