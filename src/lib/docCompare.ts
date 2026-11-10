// Phase P8: comparing the student's documents, aspect by aspect, with page references. It shows what each document
// says side by side, what it names in common (datasets, models, metrics), and values that differ for the same metric.
// Sharing a word or a concept never makes two methods "the same": the page says so.

import { CATEGORY_LABELS, sentences, terms, type Category, type DocLike, type Finding, type Passage, where } from './docAnalysis';
import { ASPECTS, type AspectKey, type DeepAnalysis, type ItemKind } from './deepAnalysis';
import { conceptLabel, conceptsOf, WEAK_CONCEPTS } from './thesaurus';

export type CompareDoc = DocLike & { findings: Finding[]; deep?: DeepAnalysis };
export type Row = { key: CompareKey; label: string };
export type CompareKey = 'objectives' | 'method' | 'data' | 'models' | 'protocol' | 'metrics' | 'results' | 'limitations';
export const ROWS: Row[] = [
  { key: 'objectives', label: 'Research objectives' }, { key: 'method', label: 'Methodology' }, { key: 'data', label: 'Datasets' },
  { key: 'models', label: 'Models and algorithms' }, { key: 'protocol', label: 'Experimental configuration' }, { key: 'metrics', label: 'Evaluation metrics' },
  { key: 'results', label: 'Findings' }, { key: 'limitations', label: 'Limitations' },
];
const FROM_DEEP: Record<CompareKey, AspectKey[]> = { objectives: ['objectives', 'questions'], method: ['method'], data: ['data'], models: ['models'], protocol: ['protocol'], metrics: ['metrics'], results: ['results_quant', 'results_qual'], limitations: ['limitations'] };
const FROM_FINDINGS: Record<CompareKey, Category[]> = { objectives: ['objectives', 'questions', 'hypotheses'], method: ['method'], data: ['data'], models: ['models'], protocol: ['experiments'], metrics: ['metrics'], results: ['results', 'conclusions'], limitations: ['limitations', 'future'] };

export type Cell = { text: string; kind: ItemKind; where: string; section: string; source: 'ai' | 'document' }[];
export type Comparison = {
  docs: { id: string; title: string }[];
  rows: { key: CompareKey; label: string; cells: Cell[]; common: string[]; names: string[] }[];
  conflicts: { metric: string; values: { docId: string; title: string; value: string; where: string; quote: string }[] }[];
};

const passageOf = (d: CompareDoc, id: string): Passage | undefined => d.passages.find((p) => p.id === id);

/** What a document says about one aspect: the AI analysis when it exists, otherwise its own sentences (P7). */
export function cellOf(d: CompareDoc, key: CompareKey): Cell {
  if (d.deep) {
    const out: Cell = [];
    for (const a of FROM_DEEP[key]) for (const it of d.deep.aspects[a]?.items ?? []) {
      const p = passageOf(d, it.passage);
      out.push({ text: it.text, kind: it.kind, where: p ? where(p) : '', section: p?.section ?? '', source: 'ai' });
    }
    if (out.length) return out.slice(0, 6);
  }
  return d.findings.filter((f) => FROM_FINDINGS[key].includes(f.category)).slice(0, 4).map((f) => ({ text: f.text, kind: 'stated', where: where(f), section: f.section, source: 'document' }));
}

/** Proper names a document uses: RiverLight, ResNet-50, LSTM, GB/T… (capitals or digits inside a word). */
export function namesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z][a-z]+[A-Z][A-Za-z0-9-]*|[A-Za-z]*[A-Z]{2,}[A-Za-z0-9-]*|[A-Za-z]+-?\d+[A-Za-z0-9-]*)\b/g)) {
    const n = m[1];
    if (/^(RQ\d|H\d|PDF|DOI|URL|NO|AND|THE|II|III|IV)$/.test(n) || n.length < 3) continue;
    out.add(n);
  }
  return out;
}

// Metric names and the value stated for them: "accuracy of 0.91", "RMSE = 1.20", "准确率为0.91". A number in a table row
// or next to another metric is not taken, because which column it belongs to cannot be known from the text.
const LINK = String.raw`\s*(?:\([^)]{0,20}\)\s*)?(?:of|=|:|was|is|were|reached|achieved|of about|为|达到|是|：)\s*(?:about\s*|approximately\s*)?(\d+(?:\.\d+)?\s*%?)(?![\d.])`;
const metric = (names: string) => new RegExp(names + LINK, 'gi');
const METRICS: [string, RegExp][] = [
  ['accuracy', metric(String.raw`(?:\baccuracy|准确率)`)],
  ['RMSE', metric(String.raw`(?:\b(?:rmse|root mean square error)|均方根误差)`)],
  ['MAE', metric(String.raw`(?:\b(?:mae|mean absolute error)|平均绝对误差)`)],
  ['F1', metric(String.raw`\b(?:f1(?:-score)?|f-score)`)],
  ['AUC', metric(String.raw`\bauc`)],
  ['R²', metric(String.raw`\b(?:r2|r\^2|r-squared|nse)`)],
];
export function metricValues(d: CompareDoc) {
  const out: { metric: string; value: string; where: string; quote: string }[] = [];
  for (const p of d.passages) {
    if (p.front || p.category === 'references') continue;
    for (const [metric, re] of METRICS) for (const m of p.text.matchAll(re)) {
      const start = Math.max(0, (m.index ?? 0) - 30);
      out.push({ metric, value: m[1].replace(/\s+/g, ''), where: where(p), quote: p.text.slice(start, (m.index ?? 0) + m[0].length).trim() });
    }
  }
  return out;
}

export function compareDocs(docs: CompareDoc[]): Comparison {
  const rows = ROWS.map((r) => {
    const cells = docs.map((d) => cellOf(d, r.key));
    const concepts = cells.map((c) => conceptsOf(c.map((x) => x.text).join(' ')));
    const common = docs.length > 1 ? [...concepts[0]].filter((id) => !WEAK_CONCEPTS.has(id) && concepts.every((s) => s.has(id))).map(conceptLabel) : [];
    const nameSets = cells.map((c) => namesIn(c.map((x) => x.text).join(' ')));
    const names = docs.length > 1 ? [...nameSets[0]].filter((n) => nameSets.every((s) => s.has(n))) : [];
    return { key: r.key, label: r.label, cells, common, names };
  });
  // The same metric reported with different values in different documents.
  const all = docs.flatMap((d) => metricValues(d).map((v) => ({ ...v, docId: d.id, title: d.meta.title ?? d.fileName })));
  const conflicts: Comparison['conflicts'] = [];
  for (const metric of [...new Set(all.map((v) => v.metric))]) {
    const vs = all.filter((v) => v.metric === metric);
    const byDoc = new Map<string, typeof vs>();
    for (const v of vs) byDoc.set(v.docId, [...(byDoc.get(v.docId) ?? []), v]);
    if (byDoc.size < 2) continue;
    const firsts = [...byDoc.values()].map((x) => x[0]);
    if (new Set(firsts.map((v) => v.value)).size > 1) conflicts.push({ metric, values: firsts.map(({ docId, title, value, where: w, quote }) => ({ docId, title, value, where: w, quote })) });
  }
  return { docs: docs.map((d) => ({ id: d.id, title: d.meta.title ?? d.fileName })), rows, conflicts };
}

// ---------- Helping the thesis step ----------

/** Aspects this step needs that none of the documents covers: where the student must look further. */
export function gapsFor(stepCats: Category[], docs: CompareDoc[]): string[] {
  return stepCats.filter((c) => !docs.some((d) => d.findings.some((f) => f.category === c) || (d.deep && ASPECTS.some((a) => a.cats.includes(c) && d.deep!.aspects[a.key]?.status === 'found')))).map((c) => CATEGORY_LABELS[c]);
}

const CITED = /\[@[^\]]+\]|\[\d+(?:[,–-]\s*\d+)*\]|\([^()]*\d{4}[a-z]?[^()]*\)|（[^（）]*\d{4}[^（）]*）/;
export type CitationNeed = { sentence: string; title: string; where: string; reason: string };

/**
 * Sentences of the student's text that restate a source without citing it: most of their words, or a number together
 * with the concept it measures, come from one passage. They are reminders, not accusations.
 */
export function citationsNeeded(text: string, docs: CompareDoc[]): CitationNeed[] {
  const out: CitationNeed[] = [];
  const parts = text.split(/\n+/).flatMap((line) => sentences(line));
  const passages = docs.flatMap((d) => d.passages.filter((p) => !p.front && p.category !== 'references').map((p) => ({ d, p, t: new Set(terms(p.text)), n: new Set(p.text.match(/\d+(?:\.\d+)?/g) ?? []) })));
  for (const raw of parts) {
    const s = raw.trim();
    if (s.length < 30 || CITED.test(s)) continue;
    const st = [...new Set(terms(s))];
    const nums = (s.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !/^(19|20)\d\d$/.test(n) && n.length > 1);
    let best: { d: CompareDoc; p: Passage; share: number; num?: string } | null = null;
    for (const x of passages) {
      const share = st.length ? st.filter((w) => x.t.has(w)).length / st.length : 0;
      const num = nums.find((n) => x.n.has(n));
      const score = share + (num ? 0.3 : 0);
      if (!best || score > best.share + (best.num ? 0.3 : 0)) best = { d: x.d, p: x.p, share, num };
    }
    if (!best) continue;
    if ((st.length >= 5 && best.share >= 0.6) || (best.num && best.share >= 0.3)) {
      out.push({ sentence: s, title: best.d.meta.title ?? best.d.fileName, where: where(best.p), reason: best.num ? `it gives the value ${best.num}, which comes from this source` : 'most of its words come from this source' });
    }
  }
  return out;
}

/** Questions the student should investigate for this step, built from what their sources say. */
export function questionsFor(stepCats: Category[], hits: { title: string; passage: Passage }[], gaps: string[]): string[] {
  const q: string[] = [];
  const first = (c: Category[]) => hits.find((h) => c.includes(h.passage.category));
  const m = first(['method', 'models']);
  if (m && stepCats.some((c) => ['method', 'models'].includes(c))) q.push(`Why would your method differ from the one in “${m.title}” (${where(m.passage)})? What in your data or question justifies your choice?`);
  const d = first(['data']);
  if (d) q.push(`Could you obtain data like that in “${d.title}” (${where(d.passage)})? If not, what does that change in your design?`);
  const r = first(['results', 'conclusions']);
  if (r) q.push(`Were the results in “${r.title}” (${where(r.passage)}) obtained under conditions like yours? What would make them comparable?`);
  const l = first(['limitations', 'future']);
  if (l) q.push(`Does the limitation in “${l.title}” (${where(l.passage)}) also apply to your work, and how would you address it?`);
  for (const g of gaps.slice(0, 2)) q.push(`None of your sources covers “${g.toLowerCase()}” for this step: which recent studies would? Search for them, then add them to My sources.`);
  return q.slice(0, 5);
}
