import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyse, search, STEP_SECTIONS } from '@/lib/docAnalysis';
import { citationsNeeded, compareDocs, gapsFor, metricValues, namesIn, questionsFor, type CompareDoc } from '@/lib/docCompare';
import { DEEP_SYSTEM, deepMessages, DEPTH, MAX_SENT_CHARS, normalizeDeep, numbersIn, quoteIn, selectPassages, sentChars, toSent } from '@/lib/deepAnalysis';
import { extractFile } from '@/lib/docExtract';
import { metaKeyOf, type SourceDoc } from '@/lib/docStore';
import { conceptsOf } from '@/lib/thesaurus';

// Phase P8. All documents are synthetic (e2e/source-docs/make.py).
const load = async (n: string): Promise<CompareDoc> => {
  const x = await extractFile(n, new Uint8Array(readFileSync(`e2e/source-docs/${n}`)), 'node_modules/pdfjs-dist/cmaps/');
  return { id: n, fileName: n, ...analyse(x) };
};

describe('search by meaning', () => {
  it('finds passages written with other words, in English and across languages', async () => {
    const en = await load('paper-en.pdf');
    const zh = await load('thesis-zh.pdf');
    const corpus = search([en], 'corpus samples')[0];
    expect(corpus?.passage.text).toContain('RiverLight dataset');
    expect(corpus?.concepts).toContain('dataset');
    expect(search([en], 'corpus samples', { meaning: false })).toEqual([]); // the words alone do not match
    const acc = search([en], '准确率 预测', { limit: 5 });
    expect(acc.some((h) => /accuracy/.test(h.passage.text))).toBe(true);
    const rain = search([zh], 'flood forecasting dataset');
    expect(rain[0]?.docId).toBe('thesis-zh.pdf');
  });
  it('unrelated topics still find nothing; general words alone are not enough', async () => {
    const docs = [await load('paper-en.pdf'), await load('thesis-zh.pdf'), await load('paper-b.pdf')];
    expect(search(docs, 'protein folding molecular dynamics simulation')).toEqual([]);
    expect(search(docs, 'stock market volatility')).toEqual([]);
    expect(search(docs, 'model evaluation results')).toEqual([]); // only general concepts
  });
  it('short words are whole words', () => {
    expect([...conceptsOf('a mapping of rivers')]).not.toContain('detection_metric');
    expect([...conceptsOf('the mAP was 0.5')]).toContain('detection_metric');
  });
});

describe('AI analysis: only selected passages, every item traceable', () => {
  it('selects the abstract first and passages for each aspect, never the title block or the bibliography', async () => {
    const d = await load('paper-en.pdf');
    for (const depth of ['quick', 'standard', 'thorough'] as const) {
      const ps = selectPassages(d, depth);
      expect(ps.length).toBeLessThanOrEqual(DEPTH[depth].passages);
      expect(ps.some((p) => p.front || p.category === 'references')).toBe(false);
      expect(sentChars(ps)).toBeLessThanOrEqual(MAX_SENT_CHARS);
    }
    expect(selectPassages(d)[0].category).toBe('abstract');
    const long = await load('long.pdf');
    expect(selectPassages(long, 'thorough').length).toBeLessThanOrEqual(22);
  });
  it('drops invented numbers and unknown passages, and turns unverified quotes into interpretation', async () => {
    const d = await load('paper-en.pdf');
    const sent = toSent(selectPassages(d));
    const data = sent.find((p) => p.text.includes('12,000 fictional samples'))!;
    const r = normalizeDeep({
      aspects: {
        data: [
          { text: 'The dataset has 12,000 samples.', kind: 'stated', passage: data.id, quote: '12,000 fictional samples' },
          { text: 'The dataset has 15,000 samples.', kind: 'stated', passage: data.id, quote: 'x' },
          { text: 'Data from elsewhere.', kind: 'stated', passage: 'p999', quote: 'x' },
          { text: 'Collected hourly, it seems.', kind: 'stated', passage: data.id, quote: 'not in the passage at all' },
          { text: data.text.slice(0, 200), kind: 'interpretation', passage: data.id },
        ],
        theory: [],
      },
    }, sent);
    expect(r.aspects.data.items).toEqual([
      { text: 'The dataset has 12,000 samples.', kind: 'stated', passage: data.id, quote: '12,000 fictional samples' },
      { text: 'Collected hourly, it seems.', kind: 'interpretation', passage: data.id },
    ]);
    expect(r.dropped).toBe(3); // invented number, unknown passage, copied text
    expect(r.aspects.theory).toEqual({ status: 'not_found', items: [] });
    expect(r.aspects.limitations.status).toBe('not_found');
  });
  it('checks numbers and quotes in English and Chinese', () => {
    expect(numbersIn('12000 samples, 8%', 'It has 12,000 samples and 8 % missing.')).toBe(true);
    expect(numbersIn('0.95 accuracy', 'accuracy of 0.91')).toBe(false);
    expect(quoteIn('一万二千个虚构样本', '数据集包含一万二千个 虚构样本。')).toBe(true);
    expect(quoteIn('“Data were collected”', 'Data were collected every hour.')).toBe(true);
  });
  it('the request holds only the chosen passages and the rules', async () => {
    const d = await load('paper-en.pdf');
    const sent = toSent(selectPassages(d, 'quick'));
    const m = deepMessages({ title: 'Paper', passages: sent });
    expect(m[1].content.match(/<passage /g)).toHaveLength(sent.length);
    expect(m[1].content).not.toContain('Alice Fiction and Bob Example'); // the title block is not sent
    expect(DEEP_SYSTEM).toMatch(/Never invent a parameter, a number, a result/);
    expect(DEEP_SYSTEM).toMatch(/not found/);
  });
  it('a corrected detail makes the stored analysis out of date', async () => {
    const d = { ...(await load('paper-en.pdf')), owner: 'guest', kind: 'pdf', fileBytes: 1, pages: 4, importedAt: '', status: 'ready', permission: { confirmedAt: '' } } as unknown as SourceDoc;
    expect(metaKeyOf({ ...d, corrected: { year: '2022' } })).not.toBe(metaKeyOf(d));
  });
});

describe('comparing documents', () => {
  it('shows each document per aspect with pages, common names, and conflicting values', async () => {
    const a = await load('paper-en.pdf');
    const b = await load('paper-b.pdf');
    const c = compareDocs([a, b]);
    const data = c.rows.find((r) => r.key === 'data')!;
    expect(data.names).toContain('RiverLight');
    expect(data.cells[1].some((x) => x.text.includes('GlowRiver') && x.where.startsWith('page'))).toBe(true);
    const acc = c.conflicts.find((x) => x.metric === 'accuracy')!;
    expect(acc.values.map((v) => [v.docId, v.value])).toEqual([['paper-en.pdf', '0.91'], ['paper-b.pdf', '0.78']]);
    expect(c.conflicts.find((x) => x.metric === 'RMSE')!.values.map((v) => v.value)).toEqual(['1.20', '1.60']);
    // A lantern network and gradient boosting share general words, not a method.
    expect(c.rows.find((r) => r.key === 'models')!.common).not.toContain('tree-based model');
  });
  it('an AI analysis, when present, is used and labelled; otherwise the document’s own sentences', async () => {
    const a = await load('paper-en.pdf');
    const sent = toSent(selectPassages(a));
    const data = sent.find((p) => p.text.includes('12,000 fictional samples'))!;
    const { aspects, dropped } = normalizeDeep({ aspects: { data: [{ text: 'It has 12,000 samples.', kind: 'stated', passage: data.id, quote: '12,000 fictional samples' }] } }, sent);
    const withAi = { ...a, deep: { at: '', examined: [], aspects, language: 'English', depth: 'standard' as const, metaKey: '', dropped } };
    const row = compareDocs([withAi, await load('paper-b.pdf')]).rows.find((r) => r.key === 'data')!;
    expect(row.cells[0][0]).toMatchObject({ text: 'It has 12,000 samples.', kind: 'stated', source: 'ai', where: 'page 2' });
    expect(row.cells[1][0].source).toBe('document');
  });
  it('the title block is never taken for data, even in records saved before this fix', async () => {
    const b = await load('paper-b.pdf');
    const front = b.passages.find((p) => p.front)!;
    expect(front.text).toContain('Sample College');
    expect(b.findings.some((f) => f.passageId === front.id)).toBe(false);
    const old = { ...b, findings: [{ category: 'data' as const, passageId: front.id, page: 1, section: front.section, text: front.text }, ...b.findings] };
    const row = compareDocs([await load('paper-en.pdf'), old]).rows.find((r) => r.key === 'data')!;
    expect(row.cells[1].some((x) => x.text.includes('Sample College'))).toBe(false);
    expect(row.cells[1].some((x) => x.text.includes('GlowRiver'))).toBe(true);
  });
  it('a Chinese summary that shares a short phrase with its passage is kept; a copied sentence is not', async () => {
    const sent = toSent(selectPassages(await load('thesis-zh.pdf')));
    // Every Chinese section is examined, short as its passages are.
    expect(sent.map((p) => p.id)).toEqual(['p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
    const p = sent.find((x) => x.text.includes('仍然存在传感器稀疏的问题'))!;
    const r = normalizeDeep({ aspects: {
      problem: [{ text: '研究指出虚构洪水预测仍然存在传感器稀疏的问题，需要新方法。', kind: 'interpretation', passage: p.id }],
      objectives: [{ text: '虚构洪水预测仍然存在传感器稀疏的问题。本文旨在研究灯笼网络能否利用稀疏传感器。', kind: 'interpretation', passage: p.id }],
    } }, sent);
    expect(r.aspects.problem.items).toHaveLength(1);
    expect(r.aspects.objectives.items).toHaveLength(0);
    expect(r.dropped).toBe(1);
  });
  it('names and metric values', async () => {
    expect([...namesIn('We use ResNet-50, LSTM and the RiverLight set; RQ1 asks.')].sort()).toEqual(['LSTM', 'ResNet-50', 'RiverLight']);
    expect(metricValues(await load('thesis-zh.pdf'))).toEqual([]); // Chinese numbers written in words are not invented as values
  });
});

describe('helping the thesis step', () => {
  it('gaps, questions with pages, and sentences that need a citation', async () => {
    const docs = [await load('paper-en.pdf')];
    expect(gapsFor(['hypotheses', 'method'], docs)).toEqual(['Hypotheses']);
    const hits = search(docs, 'lantern network flood forecasting', { boost: STEP_SECTIONS.method });
    const q = questionsFor(STEP_SECTIONS.method, hits, gapsFor(STEP_SECTIONS.method, docs));
    expect(q.length).toBeGreaterThan(0);
    expect(q.every((x) => /page \d|None of your sources/.test(x))).toBe(true);
    const work = 'Lantern networks reach an RMSE of 1.20 on sparse rivers. Lantern networks reach an RMSE of 1.20 on sparse rivers [@fiction2023]. I will install two gauges on my own campus river next spring.';
    const needs = citationsNeeded(work, docs);
    expect(needs).toHaveLength(1);
    expect(needs[0].reason).toBe('it gives the value 1.20, which comes from this source');
    expect(needs[0].where).toMatch(/^page [23]$/); // the results table (page 2) or the results text (page 3)
  });
});
