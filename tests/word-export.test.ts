import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { applySituation, emptyPath, STEPS, type PathState } from '@/lib/path';
import { STRUCTURES } from '@/lib/structures';
import { buildThesisDocx, cleanText, documentXml, exportBlocks, exportFileName, textBlocks, type Block } from '@/lib/wordExport';

// Phase P1: the Word export. All data is synthetic.
const NOW = new Date('2026-11-10T03:00:00Z');
const base = (over: Partial<PathState> = {}): PathState => ({ ...applySituation(emptyPath(), 'title', {}), started: true, topic: 'Lanterns in deep learning', discipline: 'Computer science', ...over });
const texts = (b: Block[]) => b.map((x) => ('text' in x ? `${x.kind}:${x.text}` : x.kind));
const h1s = (b: Block[]) => b.filter((x): x is Extract<Block, { kind: 'h1' }> => x.kind === 'h1').map((x) => x.text);

describe('order and honesty', () => {
  for (const s of STRUCTURES) {
    it(`${s.name}: every part, in order, as a chapter heading starting on a new page; empty parts are marked, never filled`, () => {
      const parts = Object.fromEntries(s.parts.filter((_, i) => i % 2 === 0).map((x) => [x.id, `Student text for ${x.title}.`]));
      const b = exportBlocks(base({ structure: s.id, parts }), NOW);
      expect(h1s(b)).toEqual(s.parts.map((x) => x.title));
      expect(b.filter((x) => x.kind === 'h1').every((x) => x.kind === 'h1' && x.pageBreak)).toBe(true);
      for (const [i, part] of s.parts.entries()) {
        const at = b.findIndex((x) => x.kind === 'h1' && x.text === part.title);
        expect(b[at + 1]).toEqual(i % 2 === 0 ? { kind: 'p', text: `Student text for ${part.title}.` } : { kind: 'note', text: 'Not written yet in Supervisor.' });
      }
      // No paragraph that the student did not write: every body paragraph comes from their parts.
      const written = Object.values(parts);
      expect(b.filter((x) => x.kind === 'p').every((x) => x.kind === 'p' && written.includes(x.text))).toBe(true);
    });
  }
  it('an empty document exports every part as not written, with the title page and contents', () => {
    const b = exportBlocks(base({ topic: '', discipline: '' }), NOW);
    expect(b[0]).toEqual({ kind: 'title', text: 'Untitled thesis' });
    expect(texts(b)).toContain('note:No title is recorded in Supervisor yet.');
    expect(b.filter((x) => x.kind === 'p')).toEqual([]);
    expect(b.filter((x) => x.kind === 'note' && x.text === 'Not written yet in Supervisor.')).toHaveLength(STRUCTURES[0].parts.length);
    expect(b.some((x) => x.kind === 'toc')).toBe(true);
    expect(h1s(b)).not.toContain('Appendix: research notes from Supervisor');
  });
  it('the title page holds only what the student recorded, and the export date', () => {
    const b = exportBlocks(base({ title: 'A study of lanterns', defenseDate: '2027-06-15' }), NOW);
    expect(texts(b).slice(0, 6)).toEqual([
      'title:A study of lanterns',
      'meta:Research topic: Lanterns in deep learning',
      'meta:Discipline: Computer science',
      'meta:Planned defense date: 15 June 2027',
      'meta:Thesis structure: Classic thesis',
      'meta:Exported from Supervisor on 10 November 2026',
    ]);
  });
  it('step notes and recorded runs go in a separate appendix, marked as not thesis text', () => {
    const p = base({
      steps: { topic: { work: 'My narrowed question\nwith a second line', checks: [], status: 'done' }, evidence: { work: STEPS.find((s) => s.id === 'evidence')!.workTemplate!, checks: [], status: 'open' }, method: { work: '# not a heading here', checks: [], status: 'open' } },
      runs: [{ id: 'r1', source: 'student', step: 'experiments', outcome: 'completed', name: 'Baseline', purpose: 'Compare', dataset: 'Fictional set', split: '', model: 'MLP', settings: '', seeds: '1', versions: '', hardware: '', duration: '', metrics: [{ name: 'accuracy', value: 0.81, split: 'test' }], log: '', notes: '', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' }],
    });
    const b = exportBlocks(p, NOW);
    const at = b.findIndex((x) => x.kind === 'h1' && x.text === 'Appendix: research notes from Supervisor');
    expect(at).toBeGreaterThan(b.findIndex((x) => x.kind === 'h1' && x.text === 'References'));
    const appendix = texts(b.slice(at));
    expect(appendix[1]).toMatch(/^note:.*not thesis text/);
    expect(appendix).toContain('h2:Choose a topic you can finish');
    expect(appendix).toContain('p:My narrowed question');
    expect(appendix).toContain('p:with a second line');
    expect(appendix).toContain('h2:Design your method (step in progress)');
    expect(appendix).toContain('p:# not a heading here');
    expect(appendix.some((x) => x.startsWith('h2:Bring your results'))).toBe(false); // only the untouched template
    expect(appendix).toContain('h2:Experiment runs you recorded');
    expect(appendix.find((x) => x.startsWith('h3:Run: Baseline'))).toBeTruthy();
    expect(appendix).toContain('p:Results: accuracy (test) = 0.81');
  });
});

describe('text', () => {
  it('lines become paragraphs; ## and ### become subsection headings; blank lines are dropped', () => {
    expect(textBlocks('First paragraph.\r\n\r\n## Data\nSecond.\n### Split\n   \nThird.\n# Also a subsection')).toEqual([
      { kind: 'p', text: 'First paragraph.' },
      { kind: 'h2', text: 'Data' },
      { kind: 'p', text: 'Second.' },
      { kind: 'h3', text: 'Split' },
      { kind: 'p', text: 'Third.' },
      { kind: 'h2', text: 'Also a subsection' },
    ]);
    expect(textBlocks('#hashtag is text')).toEqual([{ kind: 'p', text: '#hashtag is text' }]);
  });
  it('keeps French, Chinese, symbols and emoji; removes only characters Word cannot store', () => {
    const t = 'Élève : « résultats » à 95 % – ç’est ça. 中文摘要 α≤β 😀 & <tag> "q" \'s\u0007\u000B\ud800x';
    expect(cleanText(t)).toBe('Élève : « résultats » à 95 % – ç’est ça. 中文摘要 α≤β 😀 & <tag> "q" \'sx');
  });
  it('escapes markup in Word XML and keeps tabs and spaces', () => {
    const xml = documentXml([{ kind: 'p', text: 'a < b & "c" > d\tcol  two' }]);
    expect(xml).toContain('<w:t xml:space="preserve">a &lt; b &amp; &quot;c&quot; &gt; d</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">col  two</w:t>');
    expect(xml).not.toMatch(/<w:t[^>]*>[^<]*[<>][^<]*<\/w:t>/);
  });
  it('a long chapter (30,000 words) keeps every paragraph', () => {
    const para = Array(100).fill('word').join(' ');
    const b = exportBlocks(base({ parts: { introduction: Array(300).fill(para).join('\n') } }), NOW);
    expect(b.filter((x) => x.kind === 'p')).toHaveLength(300);
  });
  it('the file name uses the title in plain letters', () => {
    expect(exportFileName(base({ title: 'Étude des lanternes : réseaux & données' }), NOW)).toBe('thesis-etude-des-lanternes-reseaux-donnees-2026-11-10.docx');
    expect(exportFileName(base({ topic: '' }), NOW)).toBe('thesis-2026-11-10.docx');
    expect(exportFileName(base({ title: '中文标题' }), NOW)).toBe('thesis-2026-11-10.docx');
  });
});

describe('the .docx file', () => {
  it('holds the required parts, built-in heading styles, and nothing about the account', async () => {
    const p = base({ title: 'Lanterns & <models>', parts: { introduction: 'Bonjour « monde » 中文' } });
    const before = JSON.stringify(p);
    const zip = await JSZip.loadAsync(await buildThesisDocx(p, NOW));
    expect(Object.keys(zip.files).sort()).toEqual(['[Content_Types].xml', '_rels/', '_rels/.rels', 'docProps/', 'docProps/app.xml', 'docProps/core.xml', 'word/', 'word/_rels/', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml'].sort());
    const doc = await zip.file('word/document.xml')!.async('string');
    expect(doc).toContain('Bonjour « monde » 中文');
    expect(doc).toContain('Lanterns &amp; &lt;models&gt;');
    expect(doc).toContain('<w:pStyle w:val="Heading1"/><w:pageBreakBefore/>');
    const styles = await zip.file('word/styles.xml')!.async('string');
    expect(styles).toContain('<w:name w:val="heading 1"/>');
    const props = await zip.file('docProps/core.xml')!.async('string');
    expect(props).toContain('<dc:title>Lanterns &amp; &lt;models&gt;</dc:title>');
    expect(props).not.toMatch(/creator|lastModifiedBy|@/);
    expect(JSON.stringify(p)).toBe(before); // the export never changes the student's data
  });
});
