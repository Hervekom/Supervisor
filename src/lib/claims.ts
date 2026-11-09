// Checks numerical and qualitative claims in AI feedback against what the student actually reported.
// Conservative by design: a claim that cannot be traced to the right evidence is removed, never corrected.
// It cannot prove that a sentence is true. It stops claims the run does not support from being presented as results.

import type { RunRecord } from './runs';

export type ClaimKind =
  | 'percent' | 'points' | 'factor' | 'decimal' | 'integer' | 'date' | 'version' | 'seed' | 'config' | 'duration' | 'size'
  | 'rank' | 'prediction' | 'comparison' | 'qualitative';

// ---------- What a metric is ----------

export type MetricKind = 'proportion' | 'error' | 'loss' | 'count' | 'duration' | 'other' | 'unknown';
export type Direction = 'higher_is_better' | 'lower_is_better' | 'neutral' | 'unknown';
/** unit: 0 to 1, so it may be shown as a percentage. percent: already in percent. raw: a value in its own unit. */
export type Scale = 'unit' | 'percent' | 'raw' | 'unknown';
export type MetricInfo = { kind: MetricKind; direction: Direction; scale: Scale; aliases: string[] };

type Known = { re: RegExp; kind: MetricKind; direction: Direction; percentScale?: boolean; aliases: string[] };
/**
 * Metrics with a well-known meaning. Anything else is "unknown" and is never converted to a percentage.
 * "précision" is ambiguous in French ML writing (accuracy or precision), so it is an alias of both.
 */
const KNOWN: Known[] = [
  { re: /^(top-?\d+ )?(balanced )?acc(uracy)?$|^exactitude$|^taux de bonne classification$/, kind: 'proportion', direction: 'higher_is_better', aliases: ['accuracy', 'acc', 'exactitude', 'précision'] },
  { re: /^precision$|^précision$/, kind: 'proportion', direction: 'higher_is_better', aliases: ['precision', 'précision'] },
  { re: /^recall$|^rappel$|^sensitivity$|^sensibilité$/, kind: 'proportion', direction: 'higher_is_better', aliases: ['recall', 'rappel', 'sensitivity', 'sensibilité'] },
  { re: /^specificity$|^spécificité$/, kind: 'proportion', direction: 'higher_is_better', aliases: ['specificity', 'spécificité'] },
  { re: /^(macro |micro |weighted )?f1([- ]?score)?$|^f-?score$|^f-?measure$|^f-?mesure$/, kind: 'proportion', direction: 'higher_is_better', aliases: ['f1', 'f1-score', 'f-score', 'f-measure', 'f-mesure'] },
  { re: /^(roc[- ]?)?auc$|^auroc$|^au-?roc$/, kind: 'proportion', direction: 'higher_is_better', aliases: ['auc', 'auroc', 'roc auc'] },
  { re: /^(m)?iou$|^jaccard$|^dice$|^map$|^mean average precision$/, kind: 'proportion', direction: 'higher_is_better', aliases: ['iou', 'miou', 'jaccard', 'dice', 'map'] },
  { re: /^error rate$|^taux d['’]erreur$|^wer$|^cer$/, kind: 'proportion', direction: 'lower_is_better', aliases: ['error rate', "taux d'erreur", 'wer', 'cer'] },
  { re: /^r2$|^r²$|^r-squared$|^r squared$/, kind: 'other', direction: 'higher_is_better', aliases: ['r2', 'r²', 'r-squared'] },
  { re: /^mape$|^smape$/, kind: 'error', direction: 'lower_is_better', percentScale: true, aliases: ['mape', 'smape'] },
  { re: /^rmse$|^rmsle$|^mae$|^mse$|^mean absolute error$|^mean squared error$|^root mean squared error$|^erreur (absolue|quadratique) moyenne$/, kind: 'error', direction: 'lower_is_better', aliases: ['rmse', 'rmsle', 'mae', 'mse', 'mean absolute error', 'mean squared error'] },
  { re: /^(train(ing)? |val(idation)? |test )?loss$|^perte$|^cross[- ]?entropy$|^nll$|^bce$/, kind: 'loss', direction: 'lower_is_better', aliases: ['loss', 'perte', 'cross-entropy'] },
  { re: /^(training |inference )?(time|duration|latency)( \(?(s|ms|min)\)?)?$|^temps$|^durée$|^latence$/, kind: 'duration', direction: 'lower_is_better', aliases: ['time', 'duration', 'latency', 'temps', 'durée', 'latence'] },
  { re: /^(parameters|params|epochs|époques)$/, kind: 'count', direction: 'neutral', aliases: ['parameters', 'params', 'epochs', 'époques'] },
];

/** Classifies a metric by its name and value. Unknown names stay unknown: they are never silently treated as proportions. */
export function classifyMetric(name: string, value: number): MetricInfo {
  const base = baseName(name).name;
  const k = KNOWN.find((x) => x.re.test(base));
  if (!k) return { kind: 'unknown', direction: 'unknown', scale: /%|percent|pct|pourcent/i.test(name) ? 'percent' : 'unknown', aliases: base.length > 1 ? [base] : [] };
  const scale: Scale = k.percentScale ? 'percent' : k.kind !== 'proportion' ? 'raw' : value >= 0 && value <= 1 ? 'unit' : value > 1 && value <= 100 ? 'percent' : 'unknown';
  return { kind: k.kind, direction: k.direction, scale, aliases: [...new Set([...k.aliases, base])] };
}

const BASELINE_WORDS = /\b(baseline|reference|référence|ref)\b|\((baseline|reference|référence)\)/gi;
const SPLIT_WORDS: [RegExp, 'test' | 'validation' | 'train'][] = [
  [/\b(test|testing|held-?out|de test)\b/i, 'test'],
  [/\b(validation|val|dev)\b/i, 'validation'],
  [/\b(train|training|entraînement|d['’]entraînement)\b/i, 'train'],
];
/** "Baseline accuracy (test)" is the accuracy of the baseline, on the test split. */
function baseName(name: string): { name: string; baseline: boolean; split?: 'test' | 'validation' | 'train' } {
  let n = name.toLowerCase().trim();
  const baseline = BASELINE_WORDS.test(n);
  BASELINE_WORDS.lastIndex = 0;
  n = n.replace(BASELINE_WORDS, ' ');
  let split: 'test' | 'validation' | 'train' | undefined;
  for (const [re, s] of SPLIT_WORDS) if (re.test(n)) {
    split = s;
    n = n.replace(re, ' ');
  }
  n = n.replace(/[()[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
  return { name: n, baseline, split };
}

// ---------- Evidence ----------

export type MetricEvidence = { name: string; base: string; role: 'model' | 'baseline'; split: string; value: number; info: MetricInfo };
export type Evidence = {
  metrics: MetricEvidence[];
  seeds: Set<number>;
  dates: Set<number>;
  versions: Set<string>;
  config: Set<number>;
  durations: Set<number>;
  sizes: Set<number>;
  /** Text that may show a statistical test was run. */
  statsTest: boolean;
};

const round = (n: number) => Number(n.toPrecision(10));
/** Joins French thousands written with spaces: "12 000" → "12000". Only groups of exactly three digits are joined. */
export const joinThousands = (s: string) => s.replace(/\b(\d{1,3})((?:[   ]\d{3})+)(?![\d.,])/g, (_, a: string, b: string) => a + b.replace(/[   ]/g, ''));
const numbers = (s: string) => [...joinThousands(s).matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => toNumber(m[0])).filter((n): n is number => n !== null);

/** "12,000" is twelve thousand, "0,912" is a decimal comma, "1.2.3" is not a number. */
export function toNumber(raw: string): number | null {
  const s = raw.trim();
  if (/^[1-9]\d{0,2}(,\d{3})+$/.test(s)) return Number(s.replace(/,/g, ''));
  if (/^\d+,\d+$/.test(s)) return Number(s.replace(',', '.'));
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  return null;
}

export function evidenceOf(r: RunRecord): Evidence {
  const metrics: MetricEvidence[] = r.metrics.map((m) => {
    const b = baseName(m.name);
    const split = m.split === 'other' && b.split ? b.split : m.split;
    return { name: m.name.toLowerCase(), base: b.name, role: b.baseline ? 'baseline' : 'model', split, value: m.value, info: classifyMetric(m.name, m.value) };
  });
  const versions = new Set<string>();
  for (const v of `${r.versions}\n${r.hardware}\n${r.log}`.matchAll(/\d+(?:\.\d+)+(?:\+[A-Za-z0-9.]+)?/g)) versions.add(v[0]);
  const dates = new Set<number>();
  for (const d of `${r.createdAt} ${r.updatedAt}`.matchAll(/\d+/g)) dates.add(Number(d[0]));
  const text = `${r.notes}\n${r.settings}\n${r.log}\n${r.purpose}`;
  return {
    metrics,
    seeds: new Set(numbers(r.seeds)),
    dates,
    versions,
    config: new Set(numbers(`${r.settings}\n${r.model}`)),
    durations: new Set(numbers(r.duration)),
    sizes: new Set(numbers(`${r.dataset}\n${r.split}`)),
    statsTest: /(\bp\s*[<=≤]\s*0?[.,]\d|p-value|valeur p|t-test|test t\b|wilcoxon|anova|mann-whitney|confidence interval|intervalle de confiance|\bci\b\s*[:=(]|bootstrap)/i.test(text),
  };
}

// ---------- Rounding ----------

/**
 * A claim matches a value when it is that value rounded to the decimals the claim shows,
 * and the claim keeps at least two significant digits. So 91% or 91.2% match 91.23,
 * 0.91 matches 0.912, but 0.9 or 90% do not, and nothing matches a value it is not a rounding of.
 */
export function matches(claimRaw: string, claim: number, value: number): boolean {
  if (round(claim) === round(value)) return true;
  const digits = claimRaw.replace(/^[^\d]*/, '').replace(/[^\d.,]/g, '');
  const decimals = /[.,](\d+)$/.test(digits) ? digits.split(/[.,]/).pop()!.length : 0;
  const significant = digits.replace(/[.,]/g, '').replace(/^0+/, '').length;
  if (significant < 2) return false;
  return Math.abs(claim - value) <= 0.5 * 10 ** -decimals + 1e-12;
}
const matchesAny = (raw: string, v: number | undefined, values: Iterable<number>) => v !== undefined && [...values].some((x) => matches(raw, v, x));

// ---------- Sentence context, in English and French ----------

const PERF = /(accura|precision|précision|exactitude|recall|rappel|\bf1\b|f-score|\bauc\b|\broc\b|rmse|\bmae\b|\bmse\b|mape|\br2\b|r²|loss|perte|error|erreur|score|bleu|rouge|\biou\b|\bmap\b|perplexit|performance|improv|amélior|increase|augment|decrease|diminu|gain|gagn|drop|baisse|hausse|outperform|surpass|dépass|better|meilleur|worse|pire|higher|lower|plus élev|plus faible|faster|slower|plus rapide|plus lent|reach|atteint|achiev|obtenu|beat|bat\b|battu|progress)/i;
const ADVICE = /^\s*(run|re-?run|repeat|use|try|train|add|report|record|collect|consider|compare|aim|keep|set|split|install|upgrade|lancez|relancez|répétez|refaites|utilisez|essayez|entraînez|ajoutez|indiquez|notez|comparez|visez|gardez|fixez|découpez|installez)\b|\b(you should|you could|you can|you may want|consider|try to|at least|aim for|we recommend|or later|or newer|vous devriez|vous pouvez|pensez à|essayez de|au moins|visez|ou plus récent)\b/i;
/** A change claim: "improved by", "dropped 5%", "a 3% gain". */
const CHANGE = /(improv|increas|decreas|drop|rose|rise|rais|fell|fall|reduc|gain|boost|declin|grew|grow|lift|amélior|augment|diminu|baiss|rédui|réduct|progress|chut|hausse|recul|gagn)/i;
const IMPROVE = /(improv|gain|boost|better|lift|amélior|gagn|meilleur|progress)/i;
const WORSEN = /(worse|degrad|pire|dégrad)/i;
const UP = /(increas|rose|rise|rais|grew|grow|higher|augment|hausse|plus élev)/i;
const DOWN = /(decreas|drop|fell|fall|reduc|declin|lower|diminu|baiss|rédui|réduct|chut|recul|plus faible)/i;
const DIFF_WORDS = /(gap|difference|differ|écart|différence|above|below|au-dessus|en dessous|higher|lower|plus élev|plus faible)/i;
const PROCEDURE_NOUN = String.raw`(?:more |additional |different |other |extra |de plus |autres |nouvelles |nouveaux |supplémentaires )?(?:seeds?|graines?|runs?|exécutions?|essais?|trials?|folds?|plis|epochs?|époques?|repetitions?|répétitions?|times|fois|models?|modèles?|baselines?|datasets?|splits?)`;
const PERF_FACTOR_AFTER = /^\s*(faster|slower|better|worse|more accurate|larger|smaller|higher|lower|plus rapide|plus lent|meilleur|plus précis|plus grand|plus petit|plus élevé|plus faible)/i;
/** A predicted result: "you should then see", "would reach", "expect", "devrait atteindre". */
const PREDICT = /(you (should|will|would|could|might|may) (then )?(see|get|reach|achieve|obtain|observe)|\bwould (reach|get|achieve|be|give|yield)\b|\bwill (reach|get|achieve|be|give|yield)\b|\bexpect(ed)?\b|\blikely to (reach|be|get)\b|\bcould reach\b|\bshould reach\b|devriez (voir|obtenir|atteindre)|devrait (atteindre|donner|être)|pourrait atteindre|attendez-vous|obtiendrez|atteindrez|attendu)/i;
const HEDGE = /(cannot|can't|can not|could not|does not|do not|did not|doesn't|don't|isn't|is not|are not|not yet|\bnot\b|\bno\b|without|whether|\bif\b|would|could|should|might|need|needs|to show|to claim|to support|to test|to check|claim|unless|before you|\bne\b|\bn['’]|\bpas\b|aucun|sans|\bsi\b|pourrait|devrait|faudrait|pour montrer|pour affirmer|pour vérifier|affirmer|avant de|vérifier si|savoir si)/i;
const COMPARISON = /(outperform|\bbeats?\b|\bbeat\b|better than|worse than|superior|inferior|improves? (on|over|upon)|improved (on|over|upon)|surpass|exceed|higher than|lower than|faster than|slower than|more accurate than|ahead of|dépasse|surpasse|meilleure? que|pire que|plus rapide que|plus lent que|plus élevée? que|plus faible que|supérieure? à|inférieure? à|au-dessus de la référence|améliore .* par rapport)/i;
const QUALITATIVE: [RegExp, 'significance' | 'robustness' | 'generalization' | 'sota'][] = [
  [/statistically (significant|superior|better)|significantly (better|worse|higher|lower|improv|outperform)|statistiquement (significati|supérieur)|significativement|\bsignificant (improvement|gain|difference)/i, 'significance'],
  [/\brobust(ness)?\b|\brobuste/i, 'robustness'],
  [/generali[sz]es? well|generali[sz]ation|generali[sz]es to|généralise bien|bonne généralisation|se généralise/i, 'generalization'],
  [/state[- ]of[- ]the[- ]art|\bsota\b|état de l['’]art/i, 'sota'],
];
const VERSION_WORD = /(python|pytorch|torch|numpy|pandas|matplotlib|scikit-learn|sklearn|jupyter|cuda|driver|pilote|git|pip|vs code|version|v)\s*$/i;

type Token = { kind: ClaimKind; raw: string; value?: number; alt?: number; index: number };

/** Finds the numbers in a sentence and what kind of claim each one makes. */
export function tokens(sentence: string): Token[] {
  const out: Token[] = [];
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
  // A kind function may return 'skip' (the text is not a claim, and is set aside) or null (try the next pattern).
  const add = (re: RegExp, kind: ClaimKind | 'skip' | ((m: RegExpMatchArray) => ClaimKind | 'skip' | null), valueGroup = 1) => {
    for (const m of sentence.matchAll(re)) {
      const a = m.index ?? 0;
      const b = a + m[0].length;
      if (!free(a, b)) continue;
      const k = typeof kind === 'function' ? kind(m) : kind;
      if (!k) continue;
      taken.push([a, b]);
      if (k === 'skip') continue;
      const g = m[valueGroup];
      const v = g !== undefined ? toNumber(g) : null;
      // "1,234" is a thousand in English and a decimal in French. Either reading may be supported.
      const alt = g !== undefined && /^\d{1,3},\d{3}$/.test(g) ? Number(g.replace(',', '.')) : undefined;
      out.push({ kind: k, raw: g ?? m[0], index: a, ...(v !== null ? { value: v } : {}), ...(alt !== undefined ? { alt } : {}) });
    }
  };
  add(/\b\d{4}-\d{2}-\d{2}\b/g, 'date', 99);
  // Names with numbers, such as top-5, ResNet-50 or GPT-2, are not claims.
  add(/\b[A-Za-z]+[-_]\d+(?:\.\d+)?\b/g, 'skip');
  add(/\b\d+\.\d+\.\d+(?:\.\d+)*(?:\+[A-Za-z0-9.]+)?\b/g, 'version', 99);
  add(/\b(\d+)(?:st|nd|rd|th|e|ème|er|re)\b/gi, 'rank');
  add(/(\d+(?:[.,]\d+)?)\s?(?:percentage points?|points? de pourcentage|pp\b|points?\b)/gi, 'points');
  add(/(\d+(?:[.,]\d+)?)\s?(?:%|percent\b|per cent\b|pour ?cent\b)/gi, 'percent');
  // A number next to the word that names it belongs to that kind of evidence.
  add(/\b(?:seeds?|graines?)\s*(?:=|:|of|de|n°|no\.?)?\s*(\d+)\b/gi, 'seed');
  add(/\b(?:batch(?: size)?|lr|learning rate|taux d['’]apprentissage|layers?|couches?|dropout|weight decay|momentum)\s*(?:=|:|of|de)?\s*(\d+(?:[.,]\d+)?(?:e-?\d+)?)/gi, 'config');
  add(/(\d+(?:[.,]\d+)?)\s?(?:min\b|minutes?\b|hours?\b|heures?\b|h\b|seconds?\b|secondes?\b|days?\b|jours?\b)/gi, 'duration');
  add(/(\d{1,3}(?:,\d{3})+|\d+)\s+(?:rows?|lignes?|samples?|échantillons?|images?|examples?|exemples?|records?|instances?|observations?|participants?)\b/gi, 'size');
  // "3 times faster" is a claim. "repeat 3 times" is a procedure.
  add(/(\d+(?:[.,]\d+)?)\s?(?:x\b|×|times\b|-fold\b|fold\b|fois\b)/gi, (m) => (PERF_FACTOR_AFTER.test(sentence.slice((m.index ?? 0) + m[0].length)) ? 'factor' : 'skip'));
  // "3 seeds", "5 more runs", "10 epochs" describe what to do, not a result.
  add(new RegExp(String.raw`\b(\d+)\s+${PROCEDURE_NOUN}\b`, 'gi'), 'skip');
  add(/(\d+\.\d+(?:\+[A-Za-z0-9.]+)?)/g, (m) => (VERSION_WORD.test(sentence.slice(0, m.index ?? 0)) ? 'version' : null), 99);
  add(/\b((?:19|20)\d{2})\b/g, 'date');
  add(/(\d{1,3}(?:,\d{3})+|\d+[.,]\d+)/g, (m) => (/^\d{1,3}(,\d{3})+$/.test(m[1]) ? 'integer' : 'decimal'));
  add(/\b(\d+)\b/g, 'integer');
  return out.sort((a, b) => a.index - b.index);
}

// ---------- Which metric a sentence talks about ----------

const wordIn = (text: string, w: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(text);

/** The results a sentence refers to: by metric name first, then by split. */
function referenced(sentence: string, e: Evidence): { named: boolean; list: MetricEvidence[] } {
  const named = e.metrics.filter((m) => m.info.aliases.some((a) => wordIn(sentence, a)));
  const splits = SPLIT_WORDS.filter(([re]) => re.test(sentence)).map(([, s]) => s);
  let list = named.length ? named : e.metrics;
  if (splits.length) list = list.filter((m) => splits.includes(m.split as never));
  return { named: named.length > 0, list };
}

/** Pairs of results of the same measure. Baseline pairs support improvement claims; split pairs only support neutral gaps. */
function pairs(list: MetricEvidence[]) {
  const out: { a: MetricEvidence; b: MetricEvidence; baseline: boolean }[] = [];
  for (const a of list)
    for (const b of list) {
      if (a === b || a.base !== b.base) continue;
      const baseline = a.role === 'baseline' && b.role === 'model' && a.split === b.split;
      const splitGap = a.role === b.role && a.split !== b.split;
      if (baseline || splitGap) out.push({ a, b, baseline });
    }
  return out;
}

/** Whether a stated direction ("improved", "dropped") agrees with the data and the metric's known direction. */
function directionOk(sentence: string, a: MetricEvidence, b: MetricEvidence): boolean {
  const up = b.value > a.value;
  if (IMPROVE.test(sentence) || WORSEN.test(sentence)) {
    const d = b.info.direction;
    if (d !== 'higher_is_better' && d !== 'lower_is_better') return false;
    const better = d === 'higher_is_better' ? up : !up;
    return IMPROVE.test(sentence) ? better : !better;
  }
  if (UP.test(sentence) && !DOWN.test(sentence)) return up;
  if (DOWN.test(sentence) && !UP.test(sentence)) return !up;
  return true;
}

const hasAny = (set: Set<number>, t: Token) => [...set].some((x) => (t.value !== undefined && round(x) === round(t.value)) || (t.alt !== undefined && round(x) === round(t.alt)));

/** Why a claim is not supported, or null when it is. */
export function checkToken(t: Token, sentence: string, e: Evidence): ClaimKind | null {
  const ref = referenced(sentence, e);
  const perf = PERF.test(sentence) || ref.named;
  const advice = ADVICE.test(sentence);
  const change = CHANGE.test(sentence);
  const levels = ref.list.map((m) => m.value);
  const percentLevels = ref.list.flatMap((m) => (m.info.kind === 'proportion' && m.info.scale === 'unit' ? [m.value * 100] : m.info.scale === 'percent' ? [m.value] : []));
  const ps = pairs(ref.list);
  // An improvement or a change needs a baseline of the same measure, on the same split, going the stated way.
  const changePairs = ps.filter((p) => p.baseline && directionOk(sentence, p.a, p.b));
  const gapPairs = change ? changePairs : [...changePairs, ...ps.filter((p) => !p.baseline)];
  const diffs = gapPairs.map((p) => Math.abs(p.b.value - p.a.value));
  const pointDiffs = gapPairs.flatMap((p) => (p.a.info.kind === 'proportion' && p.a.info.scale === 'unit' ? [Math.abs(p.b.value - p.a.value) * 100] : p.a.info.scale === 'percent' ? [Math.abs(p.b.value - p.a.value)] : []));
  const relative = gapPairs.filter((p) => p.a.value !== 0).map((p) => Math.abs((p.b.value - p.a.value) / p.a.value) * 100);
  const ratios = changePairs.flatMap((p) => (p.a.value && p.b.value ? [p.b.value / p.a.value, p.a.value / p.b.value] : []));
  const m = (values: number[]) => matchesAny(t.raw, t.value, values) || matchesAny(t.raw, t.alt, values);
  const byPrecedes = /\b(by|de|of)\s*$/i.test(sentence.slice(0, t.index));

  switch (t.kind) {
    case 'version':
      return e.versions.has(t.raw) || [...e.versions].some((v) => v.startsWith(t.raw)) || advice ? null : 'version';
    case 'date':
      return perf ? 'date' : null;
    case 'rank':
      return 'rank';
    case 'seed':
      return hasAny(e.seeds, t) || advice ? null : 'seed';
    case 'config':
      return hasAny(e.config, t) || advice ? null : 'config';
    case 'duration':
      return hasAny(e.durations, t) || advice ? null : 'duration';
    case 'size':
      return hasAny(e.sizes, t) || advice ? null : 'size';
    case 'points':
      return m(pointDiffs) ? null : 'points';
    case 'factor':
      return m(ratios) ? null : 'factor';
    case 'percent':
      if (change) return m(relative) ? null : 'percent';
      if (m(percentLevels) || (DIFF_WORDS.test(sentence) && m(relative))) return null;
      if (!perf && (advice || hasAny(e.sizes, t) || hasAny(e.config, t))) return null;
      return 'percent';
    case 'decimal':
    case 'integer': {
      if (perf) {
        if (change && byPrecedes) return m(diffs) ? null : t.kind;
        if (m(levels) || (DIFF_WORDS.test(sentence) && m(diffs))) return null;
        return t.kind;
      }
      if (t.kind === 'decimal') {
        if (m(e.metrics.map((x) => x.value))) return null;
        return advice || hasAny(e.config, t) || hasAny(e.durations, t) || hasAny(e.sizes, t) ? null : 'decimal';
      }
      if (advice || hasAny(e.config, t) || hasAny(e.sizes, t) || hasAny(e.durations, t) || hasAny(e.seeds, t)) return null;
      // A small count in plain text ("two problems", "step 1") is not a result.
      return (t.value ?? 0) <= 10 ? null : 'integer';
    }
    default:
      return null;
  }
}

/** Splits a sentence into clauses, so a hedge in one clause does not excuse a claim in another. */
const clauses = (s: string) => s.split(/[,;:—–]|\b(?:but|which|while|whereas|although|though|mais|tandis que|alors que|bien que)\b/i);
function unhedged(re: RegExp, sentence: string): boolean {
  return clauses(sentence).some((c) => {
    const mm = c.match(re);
    if (!mm) return false;
    if (/\?\s*$/.test(c.trim()) || /\?\s*$/.test(sentence.trim())) return false;
    return !HEDGE.test(c.slice(0, mm.index ?? 0));
  });
}

export type Qualitative = 'significance' | 'robustness' | 'generalization' | 'sota';
export type Problems = { kinds: ClaimKind[]; qualitative: Qualitative[] };

/** The problems in one sentence, or empty lists when it can stay. */
export function analyzeSentence(sentence: string, e: Evidence): Problems {
  const s = joinThousands(sentence);
  const toks = tokens(s);
  let kinds = toks.map((t) => checkToken(t, s, e)).filter((k): k is ClaimKind => !!k);
  // A predicted result is never evidence, even when it sounds like advice.
  if (PREDICT.test(s) && toks.some((t) => ['percent', 'decimal', 'points', 'factor'].includes(t.kind) || (t.kind === 'integer' && PERF.test(s)))) kinds.unshift('prediction');
  // A comparison stated as fact needs a baseline in the run. A hedge counts only in the same clause, before the comparison.
  if (unhedged(COMPARISON, s) && !e.metrics.some((m) => m.role === 'baseline')) kinds.push('comparison');
  const qualitative = QUALITATIVE.filter(([re, k]) => unhedged(re, s) && !(k === 'significance' && e.statsTest)).map(([, k]) => k);
  if (qualitative.length) kinds.push('qualitative');
  kinds = [...new Set(kinds)];
  return { kinds, qualitative };
}

export const sentenceProblems = (sentence: string, e: Evidence): ClaimKind[] => analyzeSentence(sentence, e).kinds;

const NEUTRAL: Record<'en' | 'fr', Record<Qualitative, string>> = {
  en: {
    significance: 'This run alone does not establish statistical significance. That needs repeated runs and a statistical test.',
    robustness: 'This run alone does not show robustness. That needs tests under other conditions or data.',
    generalization: 'This run alone does not show how well the model generalizes beyond the data you used.',
    sota: 'This run alone does not support a state-of-the-art claim. That needs a fair comparison with published results.',
  },
  fr: {
    significance: 'Cette expérience seule n’établit pas de différence statistiquement significative. Il faut des répétitions et un test statistique.',
    robustness: 'Cette expérience seule ne montre pas la robustesse. Il faut des essais dans d’autres conditions ou sur d’autres données.',
    generalization: 'Cette expérience seule ne montre pas que le modèle se généralise au-delà des données utilisées.',
    sota: 'Cette expérience seule ne permet pas d’affirmer un résultat à l’état de l’art. Il faut une comparaison équitable avec des résultats publiés.',
  },
};

export type Checked = { text: string; removed: number; kinds: ClaimKind[] };

/**
 * Keeps every sentence whose claims are supported and removes the others. It never writes a new number.
 * An unsupported qualitative claim is replaced by a plain statement that the run does not establish it.
 * `said` collects neutral statements already used, so a reply does not repeat them.
 */
export function checkClaims(text: string, e: Evidence, lang: 'en' | 'fr' = 'en', said = new Set<Qualitative>()): Checked {
  const kinds = new Set<ClaimKind>();
  let removed = 0;
  const kept: string[] = [];
  for (const s of text.split(/(?<=[.!?])\s+(?=[^\s])/)) {
    const p = analyzeSentence(s, e);
    if (!p.kinds.length) {
      kept.push(s);
      continue;
    }
    removed++;
    p.kinds.forEach((k) => kinds.add(k));
    for (const q of p.qualitative) if (!said.has(q)) {
      said.add(q);
      kept.push(NEUTRAL[lang][q]);
    }
  }
  return { text: kept.join(' ').trim(), removed, kinds: [...kinds] };
}
