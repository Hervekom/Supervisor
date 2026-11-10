import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/check/route';
import { checkInBrowser, CheckProblem, countWords, EMPTY_DOCX, TOO_LARGE_FOR_BROWSER, type Stages } from '@/lib/browserCheck';
import { checkDocument } from '@/lib/check';
import { parseDocx } from '@/lib/docx';
import { MESSAGES } from '@/lib/messages';
import type { Profile } from '@/lib/types';
import { buildSyntheticThesis } from './helpers/syntheticThesis';

// Phase P2: Word Check in the browser. All documents are synthetic.
const profile = JSON.parse(readFileSync(path.join(process.cwd(), 'data/profiles/cn-nuist-international-postgraduate-2026.json'), 'utf8')) as Profile;
const opts = { degree: 'master_academic' as const, mode: 'final' as const, names: [] };
const blob = (b: Uint8Array) => new Blob([b as BlobPart]);

/** Adds files to the ZIP without referencing them, like large figures stored in the Word file. */
async function withMedia(bytes: Uint8Array, files: Record<string, number>) {
  const zip = await JSZip.loadAsync(bytes);
  for (const [name, size] of Object.entries(files)) zip.file(`word/media/${name}`, randomBytes(size));
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const para = (t: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
const table = (rows: string[][]) => `<w:tbl><w:tblPr/>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc>${para(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
async function docxOf(bodyXml: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/styles.xml', `<?xml version="1.0"?><w:styles ${NS}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style></w:styles>`);
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document ${NS}><w:body>${bodyXml}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('the same rules as before, without uploading anything', () => {
  it('gives exactly the report the server gave for the same file', async () => {
    const bytes = await buildSyntheticThesis();
    const server = checkDocument(await parseDocx(bytes), profile, opts);
    const { report } = await checkInBrowser(blob(bytes), profile, opts);
    expect(report).toEqual(server);
    expect(report.results.length).toBeGreaterThan(20);
  });
  it('blind review copies work the same way', async () => {
    const bytes = await buildSyntheticThesis();
    const blind = { ...opts, mode: 'blind' as const, names: ['Candidate Example'] };
    expect((await checkInBrowser(blob(bytes), profile, blind)).report).toEqual(checkDocument(await parseDocx(bytes), profile, blind));
  });
  it('a file far above 4 MB because of its figures gives the same report and the same extraction', async () => {
    const small = await buildSyntheticThesis();
    const big = await withMedia(small, { 'figure1.png': 6_000_000, 'figure2.jpeg': 12_000_000, 'scan.tif': 25_000_000 });
    expect(big.length).toBeGreaterThan(43_000_000);
    const a = await checkInBrowser(blob(small), profile, opts);
    const b = await checkInBrowser(blob(big), profile, opts);
    expect(b.report).toEqual(a.report);
    expect({ ...b.extraction, fileBytes: 0 }).toEqual({ ...a.extraction, fileBytes: 0 });
    expect(b.extraction.fileBytes).toBe(big.length);
  });
  it('reports each stage in order', async () => {
    const seen: Stages[] = [];
    await checkInBrowser(blob(await buildSyntheticThesis()), profile, opts, (s) => seen.push(s));
    expect(seen[0]).toEqual({ reading: 'active', extracting: 'pending', checking: 'pending' });
    expect(seen.at(-1)).toEqual({ reading: 'done', extracting: 'done', checking: 'done' });
  });
});

describe('extraction', () => {
  it('keeps every paragraph once, in order, with tables, headings, citations and three languages, across many chapters', async () => {
    const source: string[] = [];
    let xml = '';
    const add = (t: string, style?: string) => {
      source.push(t);
      xml += para(t, style);
    };
    const longParagraph = 'Une phrase très longue, avec « guillemets », l’apostrophe et 95 % [12]. '.repeat(4000).trimEnd(); // Word text keeps no trailing space
    for (let c = 1; c <= 30; c++) {
      add(`Chapter ${c} Étude ${c} 第${c}章`, 'Heading1');
      add(`${c}.1 Section in English`, 'Heading2');
      add(`Paragraph ${c}: the lantern method (Smith et al., 2024) reduced error by 3.2 percentage points [${c}].`);
      add(`中文段落 ${c}：灯笼方法的研究结果。`);
      if (c === 15) add(longParagraph);
      xml += table([[`Model ${c}`, 'Accuracy'], ['Baseline', `0.${c}`]]);
      source.push(`Model ${c}`, 'Accuracy', 'Baseline', `0.${c}`);
    }
    add('References', 'Heading1');
    add('[1] Fiction A. A lantern method[J]. Journal of Lanterns, 2024, 1(1): 1-10.');
    const bytes = await docxOf(xml);
    const doc = await parseDocx(bytes);
    // No paragraph missing, none duplicated, same order (table cells are paragraphs too).
    expect(doc.paragraphs.map((p) => p.text)).toEqual(source);
    expect(doc.tables).toHaveLength(30);
    expect(doc.tables[29].rows).toEqual([['Model 30', 'Accuracy'], ['Baseline', '0.30']]);
    expect(doc.paragraphs.filter((p) => p.level === 1)).toHaveLength(31);
    const { extraction } = await checkInBrowser(blob(bytes), profile, opts);
    expect(extraction.chapters).toHaveLength(30);
    expect(extraction.chapters[14].words).toBeGreaterThan(40_000); // the long paragraph is all there
    expect(extraction.characters).toBe(source.reduce((n, t) => n + t.length, 0));
    expect(extraction.tables).toBe(30);
  });
  it('counts words in English, French and Chinese', () => {
    expect(countWords('The lantern method works.')).toBe(4);
    expect(countWords('L’étude « porte » sur 95 % des cas.')).toBe(6); // L’étude, porte, sur, 95, des, cas
    expect(countWords('灯笼方法')).toBe(4);
  });
});

describe('problems the student can act on', () => {
  const problem = async (b: Blob) => {
    try {
      await checkInBrowser(b, profile, opts);
    } catch (e) {
      return e as CheckProblem;
    }
    throw new Error('no problem raised');
  };
  it('an old .doc or other file is not taken for a .docx', async () => {
    const e = await problem(blob(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4])));
    expect(e).toBeInstanceOf(CheckProblem);
    expect([e.message, e.stage]).toEqual([MESSAGES.documentUnreadable, 'reading']);
  });
  it('a damaged Word file, or one without a document body, is reported as unreadable', async () => {
    const cut = (await buildSyntheticThesis()).slice(0, 3000);
    expect((await problem(blob(cut))).message).toBe(MESSAGES.documentUnreadable);
    const zip = new JSZip();
    zip.file('word/other.xml', '<x/>');
    expect((await problem(blob(await zip.generateAsync({ type: 'uint8array' })))).message).toBe(MESSAGES.documentUnreadable);
  });
  it('an empty document says so', async () => {
    const e = await problem(blob(await docxOf(para('') + para('   '))));
    expect([e.message, e.stage]).toEqual([EMPTY_DOCX, 'extracting']);
  });
  it('a file too large for a browser is refused before it is read', async () => {
    const huge = { size: 300_000_000, arrayBuffer: () => { throw new Error('must not be read'); } } as unknown as Blob;
    expect((await problem(huge)).message).toBe(TOO_LARGE_FOR_BROWSER);
  });
});

describe('the server', () => {
  it('no longer accepts thesis files for Word Check, and never reads the request', async () => {
    const res = await POST();
    expect(res.status).toBe(410);
    expect((await res.json()).error).toMatch(/runs in your browser/);
  });
});
