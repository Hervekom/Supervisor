import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { addRef, type Draft, type Library } from '@/lib/library';
import { applySituation, emptyPath, type PathState } from '@/lib/path';
import { buildThesisDocx, exportBlocks, exportSummary, SUP_CLOSE, SUP_OPEN, type Block } from '@/lib/wordExport';

// Phase P6: citations and the bibliography in the Word file. Synthetic references only.
const NOW = new Date('2026-11-10T07:00:00Z');
const smith: Draft = { type: 'article', title: 'A lantern method', authors: [{ family: 'Smith', given: 'John' }], year: '2024', container: 'Journal of Lanterns', volume: '12', issue: '3', pages: '45–67', doi: '10.1234/lantern' };
const wang: Draft = { type: 'article', title: '灯笼方法研究', authors: [{ literal: '王小明' }], year: '2025', container: '虚构学报', volume: '4', pages: '1–9' };
const unused: Draft = { type: 'book', title: 'Uncited book', authors: [{ family: 'Brown', given: 'Ana' }], year: '2020', publisher: 'Example Press' };
const library = (style?: Library['style']): Library => [smith, wang, unused].reduce((l, d, i) => addRef(l, d, 'manual', NOW.toISOString(), `id${i}`), { refs: [], ...(style ? { style } : {}) } as Library);
const thesis = (over: Partial<PathState> = {}): PathState => ({
  ...applySituation(emptyPath(), 'title', {}), started: true, topic: 'Lanterns', discipline: 'CS', title: 'Synthetic citation thesis',
  parts: { introduction: 'Earlier work [@王小明2025] and [@smith2024, p. 50].', methodology: 'We follow [@smith2024; @王小明2025]. Unknown [@ghost2019].', references: '[9] A reference the student typed by hand. 2019.' },
  ...over,
});
const texts = (b: Block[]) => b.map((x) => ('text' in x ? x.text : x.kind === 'bib' ? `${x.label}|${x.segs.map((s) => s.text).join('')}` : x.kind));

describe('citations and reference list agree', () => {
  it('APA 7: author–date in text, alphabetical list of the cited references only, typed entries kept after it', () => {
    const b = exportBlocks(thesis({ library: library('apa7') }), NOW);
    const t = texts(b);
    expect(t).toContain('Earlier work (王小明, 2025) and (Smith, 2024, p. 50).');
    expect(t).toContain('We follow (Smith, 2024; 王小明, 2025). Unknown [@ghost2019].');
    const refs = b.slice(b.findIndex((x) => x.kind === 'h1' && x.text === 'References'));
    const bibs = refs.filter((x) => x.kind === 'bib').map((x) => (x.kind === 'bib' ? x.segs.map((s) => s.text).join('') : ''));
    expect(bibs).toEqual([
      'Smith, J. (2024). A lantern method. Journal of Lanterns, 12(3), 45–67. https://doi.org/10.1234/lantern',
      '王小明. (2025). 灯笼方法研究. 虚构学报, 4, 1–9.',
    ]);
    expect(bibs.join(' ')).not.toContain('Uncited book');
    expect(texts(refs).find((x) => x.includes('match no reference'))).toContain('[@ghost2019]');
    expect(texts(refs)).toContain('[9] A reference the student typed by hand. 2019.'); // kept exactly
  });
  it('GB/T 7714: numbers in order of first citation, superscript, the list in the same order', () => {
    const b = exportBlocks(thesis({ library: library('gbt7714') }), NOW);
    const t = texts(b);
    expect(t).toContain(`Earlier work ${SUP_OPEN}[1]${SUP_CLOSE} and ${SUP_OPEN}[2]50${SUP_CLOSE}.`);
    expect(t).toContain(`We follow ${SUP_OPEN}[1, 2]${SUP_CLOSE}. Unknown [@ghost2019].`);
    expect(b.filter((x) => x.kind === 'bib').map((x) => (x.kind === 'bib' ? x.label : ''))).toEqual(['[1]', '[2]']);
    expect(texts(b).filter((x) => x.startsWith('[1]|') || x.startsWith('[2]|'))).toEqual([
      '[1]|王小明. 灯笼方法研究[J]. 虚构学报, 2025, 4: 1–9.',
      '[2]|SMITH J. A lantern method[J]. Journal of Lanterns, 2024, 12(3): 45–67. DOI: 10.1234/lantern.',
    ]);
  });
  it('the Word file has superscript citations and italic journal names, and is unchanged otherwise', async () => {
    const p = thesis({ library: library('gbt7714') });
    const before = JSON.stringify(p);
    const xml = await (await JSZip.loadAsync(await buildThesisDocx(p, NOW))).file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">[1]</w:t></w:r>');
    expect(xml).not.toContain(SUP_OPEN);
    const apa = await (await JSZip.loadAsync(await buildThesisDocx(thesis({ library: library('apa7') }), NOW))).file('word/document.xml')!.async('string');
    expect(apa).toContain('<w:i/><w:iCs/></w:rPr><w:t xml:space="preserve">Journal of Lanterns</w:t>');
    expect(JSON.stringify(p)).toBe(before);
  });
  it('without a library or without citations, References stays exactly as typed (as before P6)', () => {
    for (const p of [thesis(), thesis({ library: library('apa7'), parts: { introduction: 'No citations here.', references: '[1] Typed entry.' } })]) {
      const b = exportBlocks(p, NOW);
      expect(b.filter((x) => x.kind === 'bib')).toEqual([]);
      expect(b.filter((x) => x.kind === 'ref').map((x) => ('text' in x ? x.text : ''))).toEqual([p.parts!.references]);
    }
    expect(exportSummary(thesis({ library: library('apa7'), parts: { introduction: 'No citations.' } })).limitations.join(' ')).toMatch(/cites none/);
  });
  it('the page summary reports the style, uncited references, missing keys and typed entries', () => {
    const s = exportSummary(thesis({ library: library('gbt7714') }));
    expect([s.citations, s.citedReferences, s.references, s.style]).toEqual([4, 2, 3, 'GB/T 7714 numeric (2015 rules)']);
    const l = s.limitations.join(' ');
    expect(l).toMatch(/\[@ghost2019\]/);
    expect(l).toMatch(/1 reference in your library is not cited/);
    expect(l).toMatch(/typed in References/);
    expect(l).toMatch(/2025 edition/);
  });
});
