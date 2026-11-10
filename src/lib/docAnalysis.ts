// Phase P7: organises what a research document contains, from its own text only. Every finding is a sentence or a
// passage of the document, with its page (PDF) or paragraph (Word) and its section. Nothing is summarised by AI here,
// and nothing absent from the document is added.

import type { Extracted, Line } from './docExtract';

export type Category =
  | 'abstract' | 'introduction' | 'problem' | 'objectives' | 'questions' | 'hypotheses' | 'literature' | 'method' | 'data' | 'models'
  | 'experiments' | 'metrics' | 'results' | 'discussion' | 'conclusions' | 'limitations' | 'future' | 'references' | 'appendix' | 'other';

export const CATEGORY_LABELS: Record<Category, string> = {
  abstract: 'Abstract', introduction: 'Introduction', problem: 'Research problem', objectives: 'Objectives', questions: 'Research questions', hypotheses: 'Hypotheses',
  literature: 'Literature review', method: 'Methodology and design', data: 'Datasets and data sources', models: 'Models, algorithms and tools', experiments: 'Experiments',
  metrics: 'Evaluation metrics', results: 'Results', discussion: 'Discussion', conclusions: 'Conclusions', limitations: 'Limitations', future: 'Future work', references: 'Bibliography', appendix: 'Appendix', other: 'Other',
};

export type Location = { page?: number; para?: number };
/** `front`: the title block before the first section (title, authors, institution). It is not suggested or searched. */
export type Passage = Location & { id: string; section: string; category: Category; text: string; front?: boolean };
export type Heading = Location & { text: string; level: number; category: Category };
export type Finding = Location & { category: Category; passageId: string; section: string; text: string };
export type DocMeta = { title?: string; authors?: string; institution?: string; year?: string; docType?: 'thesis' | 'paper' | 'document' };
export type MetaSource = Partial<Record<keyof DocMeta, string>>;

export type Analysis = {
  meta: DocMeta;
  /** Where each detected detail was found, for example "page 1", or "corrected by you". */
  metaSource: MetaSource;
  headings: Heading[];
  passages: Passage[];
  findings: Finding[];
  bibliography: number;
  chars: number;
  truncated: boolean;
};

export const MAX_DOC_CHARS = 3_000_000;
export const where = (l: Location) => (l.page ? `page ${l.page}` : l.para ? `paragraph ${l.para}` : 'location not recorded');

const SECTION_PATTERNS: [Category, RegExp][] = [
  ['abstract', /^(?:(?:abstract|summary)\b|摘\s*要|内容摘要)/i],
  ['introduction', /^(introduction|background|绪\s*论|引\s*言|前\s*言|研究背景)/i],
  ['literature', /^(literature review|related work|review of (the )?literature|state of the art|文献综述|相关工作|国内外研究现状|研究现状)/i],
  ['method', /^(methodology|methods?|materials and methods|research design|approach|proposed (method|approach|model)|研究方法|方法|模型设计|系统设计)/i],
  ['data', /^(data(sets?)?|data collection|data sources?|数据(集)?|实验数据|数据来源)/i],
  ['results', /^(results?|findings|results and discussion|实验结果|结果(与|和)?(分析|讨论)?)/i],
  ['experiments', /^(experiments?|experimental (setup|design|results)|evaluation|implementation|实验|实验设计|实验与分析|系统实现)/i],
  ['discussion', /^(discussion|analysis|讨\s*论|分析)/i],
  ['conclusions', /^(conclusions?|concluding remarks|summary and conclusions?|总结|结\s*论|结论与展望|总结与展望)/i],
  ['limitations', /^(limitations?|threats to validity|局限|不足)/i],
  ['future', /^(future work|future research|outlook|展望|未来工作)/i],
  ['references', /^(references|bibliography|works cited|literature cited|参考文献)\s*$/i],
  ['appendix', /^(appendix|appendices|附\s*录)/i],
];
// "1 Introduction", "2.3 Data", "Chapter 3 Method", "第三章 研究方法", "III. RESULTS"
const NUMBERED = /^(?:(?:chapter|section)\s+\d+[.:]?\s+|\d+(?:\.\d+){0,3}\.?\s+|[IVX]{1,5}\.\s+|第[一二三四五六七八九十\d]+[章节]\s*)(.{2,90})$/i;

export function categoryOf(heading: string): Category {
  const t = heading.replace(NUMBERED, '$1').replace(/^[\s.:：、]+/, '').trim();
  return SECTION_PATTERNS.find(([, re]) => re.test(t))?.[0] ?? 'other';
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Heading lines: Word heading styles, or short PDF lines in a larger font, or numbered titles. */
export function findHeadings(lines: Line[]): Heading[] {
  const body = median(lines.filter((l) => l.text.length > 60).map((l) => l.size)) || median(lines.map((l) => l.size));
  const out: Heading[] = [];
  for (const l of lines) {
    const t = l.text.trim();
    if (t.length < 2 || t.length > 100 || /[.。;；,，]$/.test(t) || /^\[?\d+\]?\s*$/.test(t)) continue;
    const big = body > 0 && l.size >= body * 1.15;
    const numbered = NUMBERED.test(t) && !/\d{4}[a-z]?\)/.test(t);
    const known = categoryOf(t) !== 'other';
    if (l.heading || big || (numbered && t.split(/\s+/).length <= 12) || (known && t.split(/\s+/).length <= 6)) {
      const level = l.heading ?? (/^\d+\.\d+\.\d+/.test(t) ? 3 : /^\d+\.\d+/.test(t) ? 2 : 1);
      out.push({ text: t, level, category: categoryOf(t), page: l.page, para: l.para });
    }
  }
  return out;
}

const CUES: [Category, RegExp][] = [
  ['problem', /\b(problem|challenge|gap|remains? (unclear|unsolved|an open)|has not been|little is known)\b|问题在于|尚未|存在.*不足|研究空白/i],
  ['objectives', /\b(this (paper|thesis|study|work) (aims?|proposes|presents|investigates)|the (aim|objective|goal|purpose) of|we propose|we aim)\b|本文(提出|旨在|研究)|研究目的|研究目标/i],
  ['questions', /\b(research questions?|RQ\d)\b|研究问题/i],
  ['hypotheses', /\b(hypothes[ie]s|H\d\b)|假设/i],
  ['data', /\b(datasets?|data set|corpus|benchmark|we collected|data were (collected|obtained)|samples?)\b|数据集|样本|语料/i],
  ['models', /\b(model|algorithm|network|architecture|transformer|CNN|LSTM|random forest|SVM|regression|framework|toolkit|library|PyTorch|TensorFlow|scikit)\b|模型|算法|网络结构/i],
  ['metrics', /\b(accuracy|precision|recall|F1|F-score|RMSE|MAE|MSE|AUC|BLEU|ROUGE|mAP|IoU|R\^?2|p\s*[<=]\s*0?\.\d+)\b|准确率|精确率|召回率|均方根误差/i],
  ['results', /\b(results? (show|indicate|demonstrate)|outperforms?|improves? .* by|achieved?|significantly (higher|lower|better))\b|结果表明|优于|提高了/i],
  ['limitations', /\b(limitations?|limited to|does not (consider|address)|a weakness)\b|局限|不足之处/i],
  ['future', /\b(future (work|research|studies)|in the future|further research)\b|未来|今后|进一步研究/i],
];

/** Sentences. A full stop inside a number (1.20) or an abbreviation followed by no space does not end one. */
export function sentences(t: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    const cjkEnd = c === '。' || c === '！' || c === '？';
    const latinEnd = (c === '.' || c === '!' || c === '?') && (i + 1 === t.length || /\s/.test(t[i + 1]));
    if (cjkEnd || latinEnd) {
      out.push(t.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  if (start < t.length) out.push(t.slice(start).trim());
  return out.filter((s) => s.length >= 12 || (hasCjk(s) && s.length >= 6));
}

/** Builds passages, headings and findings from the extracted lines. */
export function analyse(x: Extracted): Analysis {
  let chars = 0;
  let truncated = false;
  const lines: Line[] = [];
  for (const l of x.lines) {
    if (chars + l.text.length > MAX_DOC_CHARS) {
      truncated = true;
      break;
    }
    chars += l.text.length;
    lines.push(l);
  }
  const headings = findHeadings(lines);
  const headingSet = new Set(headings.map((h) => `${h.page ?? ''}|${h.para ?? ''}|${h.text}`));
  // Passages: consecutive lines of the same page and section, about 700 characters, ending at a sentence when possible.
  const passages: Passage[] = [];
  let section = '';
  let category: Category = 'other';
  let buf: Line[] = [];
  const flush = () => {
    if (!buf.length) return;
    const text = joinText(buf.map((l) => l.text)).replace(/\s+/g, ' ').replace(/(\p{L})- (\p{Ll})/gu, '$1$2').trim();
    if (text) passages.push({ id: `p${passages.length + 1}`, page: buf[0].page, para: buf[0].para, section, category, text });
    buf = [];
  };
  for (const l of lines) {
    if (headingSet.has(`${l.page ?? ''}|${l.para ?? ''}|${l.text.trim()}`)) {
      flush();
      const h = headings.find((y) => y.text === l.text.trim() && y.page === l.page && y.para === l.para)!;
      section = h.text;
      // A sub-heading of an unknown kind keeps the kind of the section above it.
      if (h.category !== 'other' || h.level === 1) category = h.category;
      continue;
    }
    if (buf.length && buf[0].page !== l.page) flush();
    buf.push(l);
    const len = buf.reduce((n, y) => n + y.text.length, 0);
    if (len > 700 && /[.!?。！？]$/.test(l.text)) flush();
    else if (len > 1400) flush();
  }
  flush();
  // Before the first known heading, a passage starting with "Abstract" is the abstract.
  for (const p of passages) if (p.category === 'other' && /^(abstract|摘\s*要)[:：\s]/i.test(p.text)) p.category = 'abstract';
  // The title block: passages before the second heading, under a first heading that is not a known section.
  const second = headings[1];
  if (headings[0] && headings[0].category === 'other') {
    for (const p of passages) {
      if (p.section !== headings[0].text || p.category !== 'other') continue;
      if (second && ((p.page ?? 0) > (second.page ?? 0) || (p.para ?? 0) > (second.para ?? Infinity))) continue;
      p.front = true;
    }
  }

  const findings: Finding[] = [];
  const add = (p: Passage, category: Category, text: string) => {
    if (findings.some((f) => f.text === text && f.category === category)) return;
    findings.push({ category, passageId: p.id, page: p.page, para: p.para, section: p.section, text: text.length > 500 ? `${text.slice(0, 500)}…` : text });
  };
  const SECTION_FINDING: Partial<Record<Category, Category>> = { abstract: 'abstract', literature: 'literature', method: 'method', data: 'data', experiments: 'experiments', results: 'results', discussion: 'results', conclusions: 'conclusions', limitations: 'limitations', future: 'future' };
  const firstOf = new Set<string>();
  for (const p of passages) {
    if (p.category === 'references') continue;
    const sc = SECTION_FINDING[p.category];
    // The opening passage of each section, so the student sees where it starts.
    if (sc && !firstOf.has(`${p.section}|${sc}`)) {
      firstOf.add(`${p.section}|${sc}`);
      add(p, sc, joinText(sentences(p.text).slice(0, 2)) || p.text.slice(0, 400));
    }
    for (const s of sentences(p.text)) for (const [cat, re] of CUES) if (re.test(s) && (cat !== 'models' || ['method', 'experiments', 'data', 'abstract'].includes(p.category))) add(p, cat, s);
  }
  const bibliography = passages.filter((p) => p.category === 'references').reduce((n, p) => n + (p.text.match(/(^|\s)\[\d+\]|\(\d{4}[a-z]?\)\.|\[[JMDCR]\]/g)?.length ?? 0), 0);
  const meta = guessMeta(x, lines, headings);
  // A source is given only for a detail that was found.
  const metaSource = Object.fromEntries(Object.entries(metaSourceOf(x, lines)).filter(([k]) => meta[k as keyof DocMeta])) as MetaSource;
  return { meta, metaSource, headings, passages, findings, bibliography, chars, truncated };
}

const hasCjk = (t: string) => /\p{Script=Han}/u.test(t);
const CJK_EDGE = /[\p{Script=Han}，。！？；：、）》」]/u;
/** Joins pieces of text: no space between two Chinese pieces, one space otherwise. */
export const joinText = (parts: string[]) => parts.reduce((out, p) => (!out ? p : CJK_EDGE.test(out.slice(-1)) && CJK_EDGE.test(p[0] ?? '') ? out + p : `${out} ${p}`), '');

function firstPageLines(x: Extracted, lines: Line[]) {
  return x.kind === 'pdf' ? lines.filter((l) => (l.page ?? 1) <= 2) : lines.slice(0, 40);
}

/** Title, authors, institution, year and type, only when the document states them. */
export function guessMeta(x: Extracted, lines: Line[], headings: Heading[]): DocMeta {
  const front = firstPageLines(x, lines);
  const text = front.map((l) => l.text).join('\n');
  const usableTitle = x.info.title;
  const biggest = [...front].filter((l) => l.text.length >= 8 && l.text.length <= 220 && categoryOf(l.text) === 'other').sort((a, b) => b.size - a.size)[0];
  const title = usableTitle ?? (x.kind === 'docx' ? (headings[0]?.text && categoryOf(headings[0].text) === 'other' ? headings[0].text : front[0]?.text) : biggest?.text);
  const institution = front.find((l) => /\b(university|institute|college|school of|academy)\b|大学|学院|研究所|研究院/i.test(l.text) && l.text.length < 160)?.text;
  const year = text.match(/\b(19[5-9]\d|20[0-4]\d)\b|(19[5-9]\d|20[0-4]\d)年/)?.slice(1).find(Boolean);
  const all = lines.slice(0, 400).map((l) => l.text).join(' ');
  const docType = /\b(thesis|dissertation)\b|学位论文|硕士|博士/i.test(text) ? 'thesis' : /\b(abstract)\b|摘要/i.test(all) && lines.some((l) => categoryOf(l.text) === 'references') ? 'paper' : 'document';
  return { ...(title ? { title } : {}), ...(x.info.author ? { authors: x.info.author } : {}), ...(institution ? { institution } : {}), ...(year ? { year } : {}), docType };
}

function metaSourceOf(x: Extracted, lines: Line[]): MetaSource {
  const front = firstPageLines(x, lines);
  const src: MetaSource = {};
  const on = (re: RegExp) => front.find((l) => re.test(l.text));
  src.title = x.info.title ? 'file properties' : x.kind === 'pdf' ? 'largest text on the first pages' : 'first heading';
  if (x.info.author) src.authors = 'file properties';
  const inst = on(/\b(university|institute|college|school of|academy)\b|大学|学院|研究所|研究院/i);
  if (inst) src.institution = where(inst);
  const yr = on(/\b(19[5-9]\d|20[0-4]\d)\b|(19[5-9]\d|20[0-4]\d)年/);
  if (yr) src.year = where(yr);
  src.docType = 'words on the first pages';
  return src;
}

// ---------- Search ----------

const STOP = new Set('the a an and or of to in on for with by from is are was were be been this that these those it its as at we our their which can may will not using use based study paper thesis research results method'.split(' '));
/** Latin words (light stemming) and Chinese character pairs. */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9-]{1,}|\d+(?:\.\d+)?/g) ?? []) {
    if (STOP.has(w) || w.length < 3) continue;
    out.push(w.replace(/ies$/, 'y').replace(/^(\w{3,})(ing|ed|es|s)$/, '$1'));
  }
  for (const run of text.match(/\p{Script=Han}+/gu) ?? []) {
    if (run.length === 1) continue;
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

export type DocLike = { id: string; fileName: string; meta: DocMeta; passages: Passage[] };
export type Hit = { docId: string; fileName: string; title: string; passage: Passage; score: number; matched: string[] };

/** Ranks passages for a query (BM25). A passage is relevant only if it shares enough of the query's terms. */
export function search(docs: DocLike[], query: string, opts: { limit?: number; boost?: Category[]; minShare?: number } = {}): Hit[] {
  const q = [...new Set(terms(query))];
  if (!q.length) return [];
  const all = docs.flatMap((d) => d.passages.filter((p) => p.category !== 'references' && !p.front).map((p) => ({ d, p, t: terms(`${p.section} ${p.text}`) })));
  if (!all.length) return [];
  const avg = all.reduce((n, x) => n + x.t.length, 0) / all.length || 1;
  const df = new Map(q.map((w) => [w, all.filter((x) => x.t.includes(w)).length]));
  const hits: Hit[] = [];
  for (const { d, p, t } of all) {
    const tf = new Map<string, number>();
    for (const w of t) if (df.has(w)) tf.set(w, (tf.get(w) ?? 0) + 1);
    if (!tf.size) continue;
    let score = 0;
    for (const [w, f] of tf) {
      const idf = Math.log(1 + (all.length - df.get(w)! + 0.5) / (df.get(w)! + 0.5));
      score += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (t.length / avg)));
    }
    if (opts.boost?.includes(p.category)) score *= 1.4;
    const matched = [...tf.keys()];
    const share = matched.length / q.length;
    if (matched.length < Math.min(2, q.length) || share < (opts.minShare ?? 0.25)) continue;
    hits.push({ docId: d.id, fileName: d.fileName, title: d.meta.title ?? d.fileName, passage: p, score, matched });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 20);
}

/** Which kinds of section help each thesis step. */
export const STEP_SECTIONS: Record<string, Category[]> = {
  topic: ['problem', 'introduction', 'future', 'limitations'], title: ['problem', 'objectives', 'questions', 'introduction'],
  literature: ['literature', 'introduction'], proposal: ['objectives', 'questions', 'hypotheses', 'method'], method: ['method', 'models', 'data'],
  alignment: ['questions', 'method', 'metrics'], experiments: ['experiments', 'data', 'metrics', 'models'], research: ['results', 'experiments', 'metrics'],
  evidence: ['results', 'metrics'], outline: ['introduction', 'conclusions'], draft: ['method', 'results', 'discussion'], revise: ['discussion', 'conclusions', 'limitations'],
};

// ---------- Closeness to a source ----------

function shingles(text: string): Set<string> {
  const out = new Set<string>();
  const words = text.toLowerCase().match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) ?? [];
  for (let i = 0; i + 5 <= words.length; i++) out.add(words.slice(i, i + 5).join(' '));
  for (const run of text.match(/\p{Script=Han}+/gu) ?? []) for (let i = 0; i + 8 <= run.length; i++) out.add(run.slice(i, i + 8));
  return out;
}

export type Closeness = { paragraph: string; index: number; share: number; level: 'very_close' | 'close'; hit: { docId: string; fileName: string; title: string; passage: Passage } };

/**
 * Paragraphs of the student's text that repeat word sequences from their documents: five words in a row (or eight
 * Chinese characters). A quotation marked with quotation marks still counts: it must then be cited.
 */
export function closeness(text: string, docs: DocLike[]): Closeness[] {
  const out: Closeness[] = [];
  const paras = text.split(/\n+/).map((p) => p.trim());
  const sources = docs.flatMap((d) => d.passages.filter((p) => p.category !== 'references').map((p) => ({ d, p, s: shingles(p.text) })));
  paras.forEach((para, index) => {
    const mine = shingles(para);
    if (mine.size < 4) return;
    let best: { share: number; d: DocLike; p: Passage } | null = null;
    for (const { d, p, s } of sources) {
      let shared = 0;
      for (const x of mine) if (s.has(x)) shared++;
      const share = shared / mine.size;
      if (!best || share > best.share) best = { share, d, p };
    }
    if (best && best.share >= 0.2) out.push({ paragraph: para, index, share: Math.round(best.share * 100) / 100, level: best.share >= 0.5 ? 'very_close' : 'close', hit: { docId: best.d.id, fileName: best.d.fileName, title: best.d.meta.title ?? best.d.fileName, passage: best.p } });
  });
  return out;
}

/** At most this many words of a passage are shown as a quotation. */
export function excerpt(text: string, words = 60) {
  if (hasCjk(text)) return text.length > words * 2 ? `${text.slice(0, words * 2)}…` : text;
  const w = text.split(/\s+/);
  return w.length > words ? `${w.slice(0, words).join(' ')}…` : text;
}
