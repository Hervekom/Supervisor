import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { applySituation, emptyPath, type PathState } from '@/lib/path';
import { STRUCTURES } from '@/lib/structures';
import { buildThesisDocx, documentXml, exportBlocks, exportSummary, inlineRuns, textBlocks, type Block } from '@/lib/wordExport';

// Phase P5: academic structure in the Word export. All content is synthetic.
const NOW = new Date('2026-11-10T06:00:00Z');
const base = (over: Partial<PathState> = {}): PathState => ({ ...applySituation(emptyPath(), 'title', {}), started: true, topic: 'Fictional lanterns', discipline: 'Computer science', title: 'A synthetic lantern thesis', ...over });
const of = <K extends Block['kind']>(b: Block[], k: K) => b.filter((x): x is Block & { kind: K } => x.kind === k);
const xmlOf = async (p: PathState) => (await JSZip.loadAsync(await buildThesisDocx(p, NOW))).file('word/document.xml')!.async('string');
const wellFormed = (xml: string) => {
  const errors: string[] = [];
  new DOMParser({ onError: (_l, m) => errors.push(String(m)) }).parseFromString(xml, 'text/xml');
  return errors;
};

const METHOD = [
  '## Data',
  'We use the synthetic **Lantern-1** set, described in *Table 3.1*.',
  'Table: Dataset sizes',
  '| Split | Images |',
  '|---|---|',
  '| Train | 800 |',
  '| Test | 200 |',
  '### 2.1.9 Already numbered by the student',
  '[Figure: Overview of the fictional pipeline]',
  '$$ L = -\\sum_i y_i \\log p_i $$',
  '$$',
  'a^2 + b^2',
  '= c^2',
  '$$',
  '- first point',
  '1. numbered point',
  'Table: a caption with no table after it',
  '$$ unfinished',
].join('\n');

describe('conventions in the student text', () => {
  it('tables, captions, figures, equations, lists and headings', () => {
    const b = textBlocks(METHOD);
    expect(b.map((x) => x.kind)).toEqual(['h2', 'p', 'table', 'h3', 'figure', 'equation', 'equation', 'li', 'li', 'p', 'p']);
    expect(of(b, 'table')[0]).toEqual({ kind: 'table', rows: [['Split', 'Images'], ['Train', '800'], ['Test', '200']], header: true, caption: 'Dataset sizes' });
    expect(of(b, 'figure')[0].caption).toBe('Overview of the fictional pipeline');
    expect(of(b, 'equation').map((e) => e.source)).toEqual(['L = -\\sum_i y_i \\log p_i', 'a^2 + b^2 = c^2']);
    // Lines that only look like a convention stay as the student typed them.
    expect(of(b, 'p').map((x) => x.text).slice(1)).toEqual(['Table: a caption with no table after it', '$$ unfinished']);
  });
  it('uneven table rows are padded at the end and reported, never moved', () => {
    const [t] = of(textBlocks('| a | b | c |\n| 1 |\n| 2 | 3 |'), 'table');
    expect(t.rows).toEqual([['a', 'b', 'c'], ['1', '', ''], ['2', '3', '']]);
    expect([t.header, t.padded]).toEqual([false, true]);
  });
  it('references are entries exactly as typed', () => {
    expect(textBlocks('[1] Fiction A. A lantern method[J]. 2024.\n\n王小明. 灯笼方法[D]. 2025.', { references: true })).toEqual([
      { kind: 'ref', text: '[1] Fiction A. A lantern method[J]. 2024.' },
      { kind: 'ref', text: '王小明. 灯笼方法[D]. 2025.' },
    ]);
  });
  it('bold and italic only when paired; stray asterisks stay', () => {
    expect(inlineRuns('a **b** c *d* e')).toContain('<w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">b</w:t>');
    expect(inlineRuns('a **b** c *d* e')).toContain('<w:i/><w:iCs/></w:rPr><w:t xml:space="preserve">d</w:t>');
    expect(inlineRuns('p < 0.05* and 2 * 3')).not.toContain('<w:i/>');
  });
});

describe('academic structure', () => {
  for (const s of STRUCTURES) {
    it(`${s.name}: chapters numbered, front and back matter not; sections, tables, figures and equations numbered per chapter`, () => {
      const main = s.parts.filter((x) => !['abstract', 'references', 'appendices'].includes(x.id));
      const parts = { abstract: 'Synthetic abstract.', [main[1].id]: METHOD, references: '[1] Fiction A. 2024.' };
      const b = exportBlocks(base({ structure: s.id, parts }), NOW);
      const h1 = of(b, 'h1').filter((x) => !x.text.startsWith('Appendix:'));
      expect(h1.map((x) => [x.text, x.number])).toEqual(s.parts.filter((x) => x.id !== 'appendices').map((x) => [x.title, main.findIndex((m) => m.id === x.id) + 1 || undefined]));
      expect(of(b, 'h2').find((x) => x.text === 'Data')?.number).toBe('2.1');
      expect(of(b, 'h3')[0].number).toBeUndefined(); // the student numbered it already
      expect(of(b, 'table')[0].number).toBe('2.1');
      expect(of(b, 'figure')[0].number).toBe('2.1');
      expect(of(b, 'equation').map((e) => e.number)).toEqual(['2.1', '2.2']);
      expect(of(b, 'ref')).toHaveLength(1);
    });
  }
  it('appendices: exported when written, numbered A.1, and left out while empty', () => {
    const withA = exportBlocks(base({ parts: { appendices: '# Appendix A Extra tables\nTable: Raw counts\n| a | b |\n| 1 | 2 |' } }), NOW);
    const h = of(withA, 'h1').map((x) => x.text);
    expect(h.indexOf('Appendices')).toBe(h.indexOf('References') + 1);
    expect(of(withA, 'table')[0].number).toBe('A.1');
    expect(of(withA, 'h2')[0]).toEqual({ kind: 'h2', text: 'Appendix A Extra tables' });
    expect(of(exportBlocks(base(), NOW), 'h1').map((x) => x.text)).not.toContain('Appendices');
  });
});

describe('the Word file', () => {
  it('is well-formed, with page numbers, a three-line table, a figure place, an equation and labelled notes', async () => {
    const p = base({ parts: { abstract: '中文摘要：一个虚构的研究。\nEnglish abstract.', methodology: METHOD, references: '[1] Fiction A. A lantern method[J]. 2024.' } });
    const zip = await JSZip.loadAsync(await buildThesisDocx(p, NOW));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(wellFormed(xml)).toEqual([]);
    expect(wellFormed(await zip.file('word/styles.xml')!.async('string'))).toEqual([]);
    expect(wellFormed(await zip.file('word/footer1.xml')!.async('string'))).toEqual([]);
    expect(await zip.file('word/footer1.xml')!.async('string')).toContain(' PAGE ');
    expect(xml).toContain('<w:titlePg/>');
    expect(xml).toContain('Chapter 3 Methodology');
    expect(xml).toContain('>3.1 Data<');
    expect(xml).toContain('>Table 3.1 Dataset sizes<');
    expect(xml).toContain('<w:tblHeader/>');
    expect(xml).toContain('insert Figure 3.1 here. Supervisor does not store images.');
    expect(xml).toContain('>Figure 3.1 Overview of the fictional pipeline<');
    expect(xml).toContain('<m:oMath><m:r><m:t xml:space="preserve">L = -\\sum_i y_i \\log p_i</m:t></m:r></m:oMath>');
    expect(xml).toContain('>(3.2)<');
    expect(xml).toContain('<w:pStyle w:val="Reference"/>');
    expect(xml).toContain('中文摘要：一个虚构的研究。');
    // Every Supervisor note is labelled, so it cannot be mistaken for thesis text.
    const notes = xml.split('<w:pStyle w:val="SupervisorNote"/>').length - 1;
    expect(notes).toBeGreaterThan(3);
    expect(xml.split('Supervisor note: </w:t>').length - 1).toBeGreaterThanOrEqual(notes);
  });
  it('adds no content: every word in the body comes from the student, a heading label, or a labelled Supervisor note', async () => {
    const p = base({ parts: { methodology: METHOD } });
    const b = exportBlocks(p, NOW);
    const studentText = METHOD;
    for (const x of b) {
      if (x.kind === 'p' || x.kind === 'li') expect(studentText).toContain(x.text.replace(/^\s+/, ''));
      if (x.kind === 'equation') expect(studentText.replace(/\s+/g, ' ')).toContain(x.source.split(' ')[0]);
      if (x.kind === 'table') for (const c of x.rows.flat()) expect(studentText).toContain(c);
    }
  });
  it('a long thesis in Chinese and English: 300 paragraphs, 60 tables and 40 equations, all present and well-formed', async () => {
    let t = '';
    for (let i = 1; i <= 60; i++) t += `## Section ${i}\n${'这是一个虚构的段落。 This is a synthetic paragraph. '.repeat(20)}\n${'More text. '.repeat(30)}\nTable: Results ${i}\n| Model | Score |\n|---|---|\n| A${i} | 0.${i} |\n${i <= 40 ? `$$ x_${i} = y_${i} $$\n` : ''}${'Closing line. '.repeat(10)}\n${'Last line. '.repeat(10)}\n${'Extra line. '.repeat(10)}\n`;
    const p = base({ parts: { results: t } });
    const b = exportBlocks(p, NOW);
    expect(of(b, 'p').length).toBe(300);
    expect(of(b, 'table')).toHaveLength(60);
    expect(of(b, 'equation')).toHaveLength(40);
    expect(of(b, 'table').at(-1)!.number).toBe('4.60');
    expect(wellFormed(documentXml(b))).toEqual([]);
  });
  it('never changes the stored thesis', async () => {
    const p = base({ parts: { methodology: METHOD, appendices: 'Appendix text' }, runs: [] });
    const before = JSON.stringify(p);
    await buildThesisDocx(p, NOW);
    exportSummary(p);
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('what the page reports', () => {
  it('counts what is exported and states each limitation', () => {
    const s = exportSummary(base({ parts: { methodology: METHOD + '\n| x |\n| 1 | 2 |', references: '[1] A.\n[2] B.' } }));
    expect([s.tables, s.paddedTables, s.figures, s.equations, s.references, s.appendices]).toEqual([2, 1, 1, 2, 2, false]);
    expect(s.emptyParts).toContain('Introduction');
    expect(s.emptyParts).not.toContain('Appendices');
    expect(s.limitations.join(' ')).toMatch(/does not store images/);
    expect(s.limitations.join(' ')).toMatch(/kept exactly as you typed them/);
    expect(s.limitations.join(' ')).toMatch(/empty cells were added/);
    expect(s.limitations.join(' ')).toMatch(/not linked to Zotero/);
  });
});
