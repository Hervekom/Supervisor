import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyse, categoryOf, closeness, excerpt, search, sentences, STEP_SECTIONS, terms, type DocLike } from '@/lib/docAnalysis';
import { DOC_MESSAGES, DocProblem, extractFile } from '@/lib/docExtract';
import { STEPS } from '@/lib/path';
import { adviceMessages, copiesSource, normalizeAdvice, type Excerpt } from '@/lib/sourceAdvice';

// Phase P7: research documents. Every document is synthetic (e2e/source-docs/make.py).
const CMAPS = 'node_modules/pdfjs-dist/cmaps/';
const file = (n: string) => new Uint8Array(readFileSync(`e2e/source-docs/${n}`));
const load = async (n: string) => {
  const x = await extractFile(n, file(n), CMAPS);
  return { id: n, fileName: n, ...analyse(x), x };
};

describe('reading documents', () => {
  it('an English paper: details from the file and page 1, sections with pages, findings with locations', async () => {
    const d = await load('paper-en.pdf');
    expect(d.x.pages).toBe(4);
    expect(d.meta).toEqual({ title: 'Lantern Networks for Fictional Flood Forecasting', authors: 'Alice Fiction; Bob Example', institution: 'Department of Imaginary Science, Example University of Lanterns', year: '2023', docType: 'paper' });
    expect(d.metaSource).toMatchObject({ title: 'file properties', institution: 'page 1', year: 'page 1' });
    expect(d.headings.map((h) => [h.text, h.category, h.page])).toEqual([
      ['Lantern Networks for Fictional Flood Forecasting', 'other', 1], ['Abstract', 'abstract', 1], ['1 Introduction', 'introduction', 1], ['2 Related Work', 'literature', 2],
      ['3 Method', 'method', 2], ['3.1 Data', 'data', 2], ['4 Results', 'results', 3], ['5 Conclusion', 'conclusions', 3], ['References', 'references', 4],
    ]);
    const f = (c: string) => d.findings.filter((x) => x.category === c);
    expect(f('questions')[0]).toMatchObject({ page: 1, section: '1 Introduction' });
    expect(f('questions')[0].text).toContain('Research question RQ1');
    expect(f('data').some((x) => x.page === 2 && x.text.includes('12,000 fictional samples'))).toBe(true);
    expect(f('metrics').some((x) => x.page === 3 && x.text.includes('RMSE of 1.20'))).toBe(true);
    expect(f('limitations')[0]).toMatchObject({ page: 3, section: '5 Conclusion' });
    expect(f('future')[0].text).toBe('Future work should test the method on real rivers and longer horizons.');
    expect(d.bibliography).toBeGreaterThanOrEqual(2);
    // The table and the figure caption are kept as text, with their page.
    expect(d.passages.some((p) => p.page === 2 && p.text.includes('Lantern 0.91 1.20'))).toBe(true);
    expect(d.passages.some((p) => p.text.includes('Figure 1. The lantern architecture'))).toBe(true);
  });
  it('every finding is a sentence of the document, nothing is added', async () => {
    for (const n of ['paper-en.pdf', 'thesis-zh.pdf', 'thesis-en-zh.docx']) {
      const d = await load(n);
      const all = d.passages.map((p) => p.text).join(' ');
      for (const f of d.findings) expect(all).toContain(f.text.replace(/…$/, ''));
    }
  });
  it('a Chinese thesis: Chinese text, chapters, year and institution', async () => {
    const d = await load('thesis-zh.pdf');
    expect(d.meta).toEqual({ title: '灯笼网络在虚构洪水预测中的应用研究', institution: '虚构大学 计算机学院', year: '2024', docType: 'thesis' });
    expect(d.headings.map((h) => h.category)).toEqual(['other', 'abstract', 'introduction', 'literature', 'method', 'results', 'conclusions', 'references']);
    expect(d.findings.find((f) => f.category === 'limitations')).toMatchObject({ page: 3, text: '本研究的局限在于所有河流均为虚构。' });
  });
  it('a Word thesis in English and Chinese: paragraph locations, its table kept', async () => {
    const d = await load('thesis-en-zh.docx');
    expect(d.x.kind).toBe('docx');
    expect(d.meta).toMatchObject({ title: 'Fictional Lantern Thesis', year: '2022', docType: 'thesis' });
    expect(d.findings.find((f) => f.category === 'method')).toMatchObject({ para: 6, section: 'Methodology' });
    expect(d.passages.some((p) => p.text.includes('Forest') && p.text.includes('0.88'))).toBe(true);
    expect(d.passages.some((p) => p.text.includes('本文旨在测量虚构灯笼的亮度'))).toBe(true);
  });
  it('missing details stay missing: no title in the properties, no year, no author', async () => {
    const d = await load('no-meta.pdf');
    expect(d.meta.authors).toBeUndefined();
    expect(d.meta.year).toBeUndefined();
    expect(d.meta.institution).toBeUndefined();
    expect(d.metaSource.year).toBeUndefined();
  });
  it('a long document keeps page numbers to the end', async () => {
    const d = await load('long.pdf');
    expect(d.x.pages).toBe(60);
    const hit = search([d], 'quantum lantern calibration')[0];
    expect(hit.passage.page).toBe(46);
  });
  it('scanned, protected, damaged and unsupported files are explained', async () => {
    const s = await extractFile('scanned.pdf', file('scanned.pdf'), CMAPS);
    expect([s.pages, s.lines.length]).toEqual([1, 0]);
    const err = (n: string, b = file(n)) => extractFile(n, b, CMAPS).then(() => null, (e) => e as DocProblem);
    expect((await err('protected.pdf'))?.message).toBe(DOC_MESSAGES.password);
    expect((await err('broken.pdf'))?.code).toBe('unreadable');
    expect((await err('notes.doc', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])))?.code).toBe('unsupported');
  });
  it('character maps for Chinese PDFs are served with the app, from the installed pdf.js', () => {
    const shipped = readdirSync('public/pdfjs/cmaps').sort();
    expect(shipped).toEqual(readdirSync('node_modules/pdfjs-dist/cmaps').sort());
    expect(readFileSync('public/pdfjs/cmaps/UniGB-UCS2-H.bcmap')).toEqual(readFileSync('node_modules/pdfjs-dist/cmaps/UniGB-UCS2-H.bcmap'));
  });
});

describe('finding what applies', () => {
  it('headings in English and Chinese', () => {
    expect(['Chapter 3 Methodology', '2.1 Related work', 'III. RESULTS', '第五章 结论与展望', '参考文献', '摘要', 'Acknowledgements'].map(categoryOf)).toEqual(['method', 'literature', 'results', 'conclusions', 'references', 'abstract', 'other']);
  });
  it('sentences do not break inside numbers', () => {
    expect(sentences('An RMSE of 1.20 was found. 准确率为零点九一。Next one here.')).toEqual(['An RMSE of 1.20 was found.', '准确率为零点九一。', 'Next one here.']);
  });
  it('terms: English words and Chinese character pairs', () => {
    expect(terms('Forecasting floods 洪水预测')).toEqual(['forecast', 'flood', '洪水', '水预', '预测']);
  });
  it('relevant documents are found; an unrelated document is not', async () => {
    const docs: DocLike[] = [await load('paper-en.pdf'), await load('thesis-zh.pdf'), await load('thesis-en-zh.docx')];
    const en = search(docs, 'flood forecasting with lantern networks', { boost: STEP_SECTIONS.method });
    expect(en[0].docId).toBe('paper-en.pdf');
    expect(search(docs, '洪水预测 灯笼网络')[0].docId).toBe('thesis-zh.pdf');
    expect(search(docs, 'protein folding molecular dynamics simulation')).toEqual([]);
    expect(search(docs, 'stock market volatility')).toEqual([]);
  });
  it('every step that uses sources names sections that exist', () => {
    for (const id of Object.keys(STEP_SECTIONS)) expect(STEPS.some((s) => s.id === id)).toBe(true);
  });
});

describe('academic integrity', () => {
  it('text copied from a source is flagged with its page; own words are not', async () => {
    const docs = [await load('paper-en.pdf')];
    const copied = 'The RiverLight dataset contains 12,000 fictional samples collected from 40 invented rivers. Data were collected every hour.';
    const own = 'My study uses rain gauges from two real catchments, which I sampled myself during one season.';
    const r = closeness(`${copied}\n${own}`, docs);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ index: 0, level: 'very_close', hit: { docId: 'paper-en.pdf', passage: { page: 2 } } });
    const zh = closeness('数据集包含一万二千个虚构样本。', [await load('thesis-zh.pdf')]);
    expect(zh[0]?.hit.passage.page).toBe(2);
  });
  it('excerpts shown are short', () => {
    expect(excerpt(Array(100).fill('word').join(' '), 40).split(' ')).toHaveLength(40);
  });
  const ex: Excerpt[] = [
    { id: 'e1', doc: 'Paper A', where: 'page 2', section: '3 Method', text: 'We design a lantern network with three glow layers and a recurrent memory trained on the RiverLight dataset.' },
    { id: 'e2', doc: 'Paper B', where: 'page 3', section: '4 Results', text: 'Results show that the lantern network achieved an accuracy of 0.91 and an RMSE of 1.20 over five seeds.' },
  ];
  it('advice keeps only points about sent excerpts, and drops any that copy them', () => {
    const a = normalizeAdvice({
      points: [
        { excerpt: 'e1', why: 'The authors justify a layered design; ask whether your data needs memory.', how: 'Compare with your choice.', cite: 'Cite Paper A, page 2.' },
        { excerpt: 'e2', why: 'Results show that the lantern network achieved an accuracy of 0.91 and an RMSE', how: '', cite: '' },
        { excerpt: 'e7', why: 'Invented.', how: '', cite: '' },
      ],
      unrelated: ['e2', 'e5'],
      caution: 'These results belong to the authors.',
    }, ex);
    expect(a.points.map((p) => p.excerpt)).toEqual(['e1']);
    expect(a.unrelated).toEqual(['e2']);
    expect(copiesSource('they achieved an accuracy of 0.91 and an RMSE of 1.20 over five seeds', ex[1].text)).toBe(true);
    expect(copiesSource('accuracy was high', ex[1].text)).toBe(false);
  });
  it('the prompt sends only the chosen excerpts and states the rules', () => {
    const m = adviceMessages({ stepTitle: 'Design your method', stepGoal: 'Choose a method.', topic: 'Lantern floods', excerpts: ex });
    expect(m[0].content).toMatch(/Never invent a citation/);
    expect(m[0].content).toMatch(/Never quote more than 12 words/);
    expect(m[0].content).toMatch(/plagiarism or AI detection/);
    expect(m[1].content.match(/<excerpt /g)).toHaveLength(2);
  });
});
