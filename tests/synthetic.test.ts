import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { checkDocument, layoutOf } from '@/lib/check';
import { parseDocx } from '@/lib/docx';
import { pageOfQuote, pdfPages } from '@/lib/profiles';
import type { Profile } from '@/lib/types';
import { buildSyntheticPdf, buildSyntheticThesis } from './helpers/syntheticThesis';

const profile = JSON.parse(fs.readFileSync('data/profiles/cn-nuist-international-postgraduate-2026.json', 'utf8')) as Profile;

// Public versions of the tests that otherwise need private university files.
describe('synthetic fixtures', () => {
  it('reads a complete document', async () => {
    const d = await parseDocx(await buildSyntheticThesis());
    expect(d.paragraphs.length).toBeGreaterThan(30);
    expect(d.sections.length).toBe(3);
    expect(d.tables.length).toBe(1);
    expect(d.evenOddHeaders).toBe(true);
    expect(Math.abs(d.sections[1].widthCm - 21)).toBeLessThan(0.1);
  });
  it('finds each part', async () => {
    const l = layoutOf(await parseDocx(await buildSyntheticThesis()));
    for (const part of ['originality', 'abstract_en', 'abstract_zh', 'table_of_contents', 'main_body', 'conclusion', 'references', 'research_outputs', 'acknowledgments'] as const) {
      expect(l.parts.has(part), part).toBe(true);
    }
    expect(l.chapters.map((c) => c.title)).toEqual(['Chapter 1 INTRODUCTION', 'Chapter 2 METHOD AND RESULTS']);
  });
  it('flags a short thesis and reports every conflict', async () => {
    const r = checkDocument(await parseDocx(await buildSyntheticThesis()), profile, { degree: 'master_academic', mode: 'final' });
    expect(r.results.length).toBeGreaterThan(30);
    expect(r.conflicts.length).toBe(10);
    expect(r.audit.length).toBeGreaterThan(1);
    expect(r.results.find((x) => x.key === 'length.main_text.min_words')?.status).toBe('fail');
  });
  it('filters rules by degree', async () => {
    const d = await parseDocx(await buildSyntheticThesis());
    const m = checkDocument(d, profile, { degree: 'master_academic', mode: 'final' });
    const p = checkDocument(d, profile, { degree: 'doctorate_academic', mode: 'final' });
    expect(m.results.find((x) => x.key === 'integrity.similarity.max_percent')?.ruleId).toBe('integrity.similarity_master');
    expect(p.results.find((x) => x.key === 'integrity.similarity.max_percent')?.ruleId).toBe('integrity.similarity_doc');
  });
  it('runs anonymity checks only in blind mode', async () => {
    const d = await parseDocx(await buildSyntheticThesis());
    expect(checkDocument(d, profile, { degree: 'master_academic', mode: 'final' }).results.some((r) => r.category === 'anonymity')).toBe(false);
    const b = checkDocument(d, profile, { degree: 'master_academic', mode: 'blind', names: ['Candidate Example'] });
    expect(b.results.find((r) => r.key === 'anonymity.acknowledgments_removed')?.status).toBe('fail');
    expect(b.results.find((r) => r.key === 'anonymity.identity_clues_removed')?.status).toBe('fail');
  });
  it('keeps a source quote on every result', async () => {
    const r = checkDocument(await parseDocx(await buildSyntheticThesis()), profile, { degree: 'master_academic', mode: 'final' });
    for (const x of r.results) expect(x.source.quote.length).toBeGreaterThan(2);
  });
  it('detects wrong body formatting', async () => {
    const r = checkDocument(await parseDocx(await buildSyntheticThesis({ wrongBodyFont: true })), profile, { degree: 'master_academic', mode: 'final' });
    expect(r.results.find((x) => x.key === 'format.body_text')?.status).toBe('fail');
  });
  it('extracts text from a PDF and locates a quote', async () => {
    const pages = await pdfPages(buildSyntheticPdf(['First fictional page of rules.', 'No fewer than 12,345 fictional words (see notes).']));
    expect(pages.length).toBe(2);
    expect(pageOfQuote(pages, 'no fewer than 12,345 fictional words')).toBe(2);
  });
});
