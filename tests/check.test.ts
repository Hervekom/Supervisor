import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import JSZip from 'jszip';
import { parseDocx, headingLevelFromText } from '@/lib/docx';
import { checkDocument, layoutOf, countEnglishWords } from '@/lib/check';
import type { Profile } from '@/lib/types';

const profile = JSON.parse(fs.readFileSync('data/profiles/cn-nuist-international-postgraduate-2026.json', 'utf8')) as Profile;
const hasFixtures = fs.existsSync('tests/fixtures/template-academic.docx');
const load = (f: string) => parseDocx(fs.readFileSync(`tests/fixtures/${f}`));

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (text: string, rpr = '<w:rFonts w:ascii="Times New Roman"/><w:sz w:val="24"/>', ppr = '<w:spacing w:line="360" w:lineRule="auto"/><w:ind w:firstLine="480"/>') =>
  `<w:p><w:pPr>${ppr}</w:pPr><w:r><w:rPr>${rpr}</w:rPr><w:t>${text}</w:t></w:r></w:p>`;

async function makeDocx(bodyXml: string) {
  const z = new JSZip();
  z.file('word/document.xml', `<?xml version="1.0"?><w:document ${W}><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr></w:body></w:document>`);
  return parseDocx(await z.generateAsync({ type: 'uint8array' }));
}
const LONG = 'This paragraph has enough words to count as real body text for the checker and it cites prior work [1]. '.repeat(2);

describe('parser', () => {
  it.skipIf(!hasFixtures)('reads the real NUIST template', async () => {
    const d = await load('template-academic.docx');
    expect(d.paragraphs.length).toBeGreaterThan(50);
    expect(d.sections.length).toBeGreaterThan(0);
    const a4 = d.sections.filter((s) => Math.abs(s.widthCm - 21) < 0.1);
    expect(a4.length).toBeGreaterThan(0);
  });
  it.skipIf(!hasFixtures)('finds the template parts', async () => {
    const d = await load('template-academic.docx');
    const l = layoutOf(d);
    expect(l.parts.has('abstract_en')).toBe(true);
    expect(l.parts.has('abstract_zh')).toBe(true);
    expect(l.parts.has('main_body')).toBe(true);
    expect(l.parts.has('references')).toBe(true);
    expect(l.parts.has('acknowledgments')).toBe(true);
  });
  it('detects typed heading numbers', () => {
    expect(headingLevelFromText('Chapter II LITERATURE REVIEW')).toBe(1);
    expect(headingLevelFromText('2.1 Background')).toBe(2);
    expect(headingLevelFromText('2.1.3 Scope')).toBe(3);
    expect(headingLevelFromText('2.1 percent of users left after the experiment and we then decided to continue with the rest of a very long sentence that keeps going and going and going and going and going')).toBe(0);
  });
  it('reads an empty docx error clearly', async () => {
    const z = new JSZip();
    z.file('a.txt', 'x');
    await expect(parseDocx(await z.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/Upload a .docx/);
  });
});

describe.skipIf(!hasFixtures)('engine on real files', () => {
  it('never crashes and flags an unfilled template as too short', async () => {
    for (const f of ['template-academic.docx', 'template-professional.docx', 'sample.docx']) {
      const r = checkDocument(await load(f), profile, { degree: 'master_academic', mode: 'final' });
      expect(r.results.length).toBeGreaterThan(30);
      expect(r.conflicts.length).toBe(10);
      const len = r.results.find((x) => x.key === 'length.main_text.min_words');
      expect(['fail', 'skipped']).toContain(len?.status);
    }
  });
  it('filters rules by degree', async () => {
    const d = await load('template-academic.docx');
    const m = checkDocument(d, profile, { degree: 'master_academic', mode: 'final' });
    const p = checkDocument(d, profile, { degree: 'doctorate_academic', mode: 'final' });
    expect(m.results.find((x) => x.key === 'integrity.similarity.max_percent')?.ruleId).toBe('integrity.similarity_master');
    expect(p.results.find((x) => x.key === 'integrity.similarity.max_percent')?.ruleId).toBe('integrity.similarity_doc');
  });
  it('runs anonymity checks only in blind mode', async () => {
    const d = await load('template-academic.docx');
    expect(checkDocument(d, profile, { degree: 'master_academic', mode: 'final' }).results.some((r) => r.category === 'anonymity')).toBe(false);
    const b = checkDocument(d, profile, { degree: 'master_academic', mode: 'blind' });
    expect(b.results.find((r) => r.key === 'anonymity.acknowledgments_removed')?.status).toBe('fail');
  });
  it('keeps every source quote on results', async () => {
    const r = checkDocument(await load('template-academic.docx'), profile, { degree: 'master_academic', mode: 'final' });
    for (const x of r.results) expect(x.source.quote.length).toBeGreaterThan(2);
  });
});

describe('individual rules on built documents', () => {
  const body = (extra = '') =>
    para('ABSTRACT', '<w:b/>', '') + para('Keywords: a; b') + para('摘要', '', '') + para('Contents', '', '') +
    para('Chapter 1 INTRODUCTION', '<w:rFonts w:ascii="Times New Roman"/><w:sz w:val="30"/><w:b/>', '<w:jc w:val="center"/>') +
    para(LONG) + extra + para('References', '', '') + para('[1] Smith J, Chen L. A title[J]. Journal, 2023, 15(4): 205–220');
  const run = async (extra = '', mode: 'final' | 'blind' = 'final', names?: string[]) =>
    checkDocument(await makeDocx(body(extra)), profile, { degree: 'master_academic', mode, names });
  const get = (r: Awaited<ReturnType<typeof run>>, k: string) => r.results.find((x) => x.key === k);

  it('passes correct body format', async () => {
    expect(get(await run(), 'format.body_text')?.status).toBe('pass');
  });
  it('fails wrong font and size', async () => {
    const r = await run(para(LONG, '<w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/>'));
    const f = get(r, 'format.body_text');
    expect(f?.status).toBe('fail');
    expect(f?.examples[0]).toMatch(/Calibri.*11 pt/);
  });
  it('counts too few keywords', async () => {
    expect(get(await run(), 'abstract.keywords_count')?.status).toBe('fail');
  });
  it('detects author-year citations', async () => {
    const r = await run(para(`${LONG} (Smith, 2020) (Lee, 2021) (Wang et al., 2019) (Chen, 2018) (Li, 2017)`));
    expect(get(r, 'citation.in_text_system')?.status).toBe('fail');
  });
  it('finds cited but unlisted references', async () => {
    const r = await run(para(`${LONG} and later work [7].`));
    expect(get(r, 'citation.numbering_options')?.detail).toMatch(/Cited but not listed: 7/);
  });
  it('finds trailing punctuation', async () => {
    const d = await makeDocx(para('Chapter 1 INTRO') + para(LONG) + para('References') + para('[1] A B. Title[J]. Journal, 2023, 1(1): 1–2.'));
    const r = checkDocument(d, profile, { degree: 'master_academic', mode: 'final' });
    expect(r.results.find((x) => x.key === 'citation.entry_trailing_punctuation')?.status).toBe('fail');
  });
  it('flags too many authors', async () => {
    const d = await makeDocx(para('Chapter 1 INTRO') + para(LONG) + para('References') + para('[1] A B, C D, E F, G H. Title[J]. Journal, 2023, 1(1): 1–2'));
    const r = checkDocument(d, profile, { degree: 'master_academic', mode: 'final' });
    expect(r.results.find((x) => x.key === 'citation.max_listed_authors')?.status).toBe('fail');
  });
  it('finds names in blind mode', async () => {
    const r = await run(para('Supervised by Zhang Wei with help from colleagues in the laboratory during the long experiments we ran.'), 'blind', ['Zhang Wei']);
    expect(get(r, 'anonymity.identity_clues_removed')?.status).toBe('fail');
  });
  it('never reports assisted rules as passed', async () => {
    const r = await run();
    for (const x of r.results) {
      const rule = profile.rules.find((y) => y.id === x.ruleId)!;
      if (rule.enforcement === 'assisted') expect(x.status).not.toBe('pass');
    }
  });
  it('reports the keyword separator used by the file', async () => {
    const r = await run();
    expect(r.conflicts.find((c) => c.id === 'conflict.keyword_separator')?.observed).toMatch(/semicolons/);
  });
  it('counts words', () => {
    expect(countEnglishWords("A state-of-the-art model, it's 2 good")).toBe(6);
  });
});
