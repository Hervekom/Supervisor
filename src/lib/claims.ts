// Checks numerical claims in AI feedback against what the student actually reported.
// Conservative by design: when a claim cannot be traced to the right kind of submitted evidence, it is removed.
// It cannot prove that a sentence is true. It only stops numbers the student never reported from being presented as results.

import type { RunRecord } from './runs';

export type ClaimKind = 'percent' | 'points' | 'factor' | 'decimal' | 'integer' | 'date' | 'version' | 'seed' | 'config' | 'duration' | 'size' | 'comparison';

/** Every number in a run, sorted by what it means. A number counts only as evidence of its own kind. */
export type Evidence = {
  metrics: Set<number>; // exact metric values
  metricPercents: Set<number>; // metric values written as percentages (0.912 -> 91.2)
  derived: Set<number>; // differences, percentage-point gaps, relative changes and ratios between metrics of the same name
  seeds: Set<number>;
  dates: Set<number>;
  versions: Set<string>;
  config: Set<number>;
  durations: Set<number>;
  sizes: Set<number>;
  metricNames: string[];
};

const round = (n: number) => Number(n.toPrecision(10));
const numbers = (s: string) => [...s.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => toNumber(m[0])).filter((n): n is number => n !== null);

/** "12,000" is twelve thousand, "0,912" is a decimal comma, "1.2.3" is not a number. */
export function toNumber(raw: string): number | null {
  const s = raw.trim();
  if (/^[1-9]\d{0,2}(,\d{3})+$/.test(s)) return Number(s.replace(/,/g, ''));
  if (/^\d+,\d+$/.test(s)) return Number(s.replace(',', '.'));
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  return null;
}

export function evidenceOf(r: RunRecord): Evidence {
  const metrics = new Set<number>();
  const metricPercents = new Set<number>();
  const derived = new Set<number>();
  for (const m of r.metrics) {
    metrics.add(round(m.value));
    metricPercents.add(round(m.value * 100));
  }
  // Calculated values are allowed only between results of the same measure, for example test and validation accuracy.
  const byName = new Map<string, number[]>();
  for (const m of r.metrics) byName.set(m.name.toLowerCase(), [...(byName.get(m.name.toLowerCase()) ?? []), m.value]);
  for (const values of byName.values())
    for (const a of values)
      for (const b of values) {
        if (a === b) continue;
        const d = Math.abs(a - b);
        derived.add(round(d));
        derived.add(round(d * 100));
        if (a !== 0) derived.add(round(Math.abs((b - a) / a) * 100));
        if (b !== 0) derived.add(round(a / b));
      }
  const versions = new Set<string>();
  for (const v of `${r.versions}\n${r.hardware}\n${r.log}`.matchAll(/\d+(?:\.\d+)+(?:\+[A-Za-z0-9.]+)?/g)) versions.add(v[0]);
  const dates = new Set<number>();
  for (const d of `${r.createdAt} ${r.updatedAt}`.matchAll(/\d+/g)) dates.add(Number(d[0]));
  return {
    metrics,
    metricPercents,
    derived,
    seeds: new Set(numbers(r.seeds)),
    dates,
    versions,
    config: new Set(numbers(`${r.settings}\n${r.model}`)),
    durations: new Set(numbers(r.duration)),
    sizes: new Set(numbers(`${r.dataset}\n${r.split}`)),
    metricNames: r.metrics.map((m) => m.name.toLowerCase()),
  };
}

// ---------- Sentence context, in English and French ----------

const PERF = /(accura|precision|précision|exactitude|recall|rappel|\bf1\b|f-score|\bauc\b|\broc\b|rmse|\bmae\b|\bmse\b|mape|\br2\b|r²|loss|perte|error|erreur|score|bleu|rouge|\biou\b|\bmap\b|perplexit|performance|improv|amélior|increase|augment|decrease|diminu|gain|gagn|drop|baisse|hausse|outperform|surpass|dépass|better|meilleur|worse|pire|higher|lower|plus élev|plus faible|faster|slower|plus rapide|plus lent|reach|atteint|achiev|obtenu|beat|bat\b|battu)/i;
// Advice is an instruction ("Repeat…", "Use…") or a recommendation ("you should", "at least"). The noun "run" is not advice.
const ADVICE = /^\s*(run|re-?run|repeat|use|try|train|add|report|record|collect|consider|compare|aim|keep|set|split|install|upgrade|lancez|relancez|répétez|refaites|utilisez|essayez|entraînez|ajoutez|indiquez|notez|comparez|visez|gardez|fixez|découpez|installez)\b|\b(you should|you could|you can|you may want|consider|try to|at least|aim for|we recommend|or later|or newer|vous devriez|vous pouvez|pensez à|essayez de|au moins|visez|ou plus récent)\b/i;
const PROCEDURE_NOUN = String.raw`(?:more |additional |different |other |extra |de plus |autres |nouvelles |nouveaux |supplémentaires )?(?:seeds?|graines?|runs?|exécutions?|essais?|trials?|folds?|plis|epochs?|époques?|repetitions?|répétitions?|times|fois|models?|modèles?|baselines?|datasets?|splits?)`;
const PERF_FACTOR_AFTER = /^\s*(faster|slower|better|worse|more accurate|larger|smaller|higher|lower|plus rapide|plus lent|meilleur|plus précis|plus grand|plus petit|plus élevé|plus faible)/i;
const HEDGE = /(cannot|can't|can not|could not|does not|do not|did not|doesn't|don't|isn't|not yet|\bnot\b|\bno\b|without|whether|\bif\b|would|could|should|might|need|needs|to show|to claim|to support|to test|claim|unless|before you|\?|\bne\b|\bn['’]|\bpas\b|aucun|sans|\bsi\b|pourrait|devrait|faudrait|pour montrer|pour affirmer|pour vérifier|affirmer|avant de)/i;
const COMPARISON = /(outperform|\bbeats?\b|better than|worse than|superior to|inferior to|improves? (on|over|upon)|improved (on|over|upon)|surpass|faster than|slower than|more accurate than|dépasse|surpasse|meilleur que|meilleure que|pire que|plus rapide que|plus lent que|supérieure? à|inférieure? à|améliore .* par rapport)/i;
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
      out.push({ kind: k, raw: m[0], index: a, ...(v !== null ? { value: v } : {}), ...(alt !== undefined ? { alt } : {}) });
    }
  };
  add(/\b\d{4}-\d{2}-\d{2}\b/g, 'date', 99);
  // Names with numbers, such as top-5, ResNet-50 or GPT-2, are not claims.
  add(/\b[A-Za-z]+[-_]\d+(?:\.\d+)?\b/g, 'skip');
  add(/\b\d+\.\d+\.\d+(?:\.\d+)*(?:\+[A-Za-z0-9.]+)?\b/g, 'version', 99);
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

const has = (set: Set<number>, v: number | undefined) => v !== undefined && set.has(round(v));
const hasAny = (set: Set<number>, t: Token) => has(set, t.value) || has(set, t.alt);

/** Why a claim is not supported, or null when it is. */
export function checkToken(t: Token, sentence: string, e: Evidence): ClaimKind | null {
  const perf = PERF.test(sentence) || e.metricNames.some((n) => n.length > 1 && sentence.toLowerCase().includes(n));
  const advice = ADVICE.test(sentence);
  const metric = hasAny(e.metrics, t) || hasAny(e.metricPercents, t) || hasAny(e.derived, t);
  switch (t.kind) {
    case 'version':
      return e.versions.has(t.raw) || [...e.versions].some((v) => v.startsWith(t.raw)) || advice ? null : 'version';
    case 'date':
      return perf ? 'date' : null;
    case 'seed':
      return hasAny(e.seeds, t) || advice ? null : 'seed';
    case 'config':
      return hasAny(e.config, t) || advice ? null : 'config';
    case 'duration':
      return hasAny(e.durations, t) || advice ? null : 'duration';
    case 'size':
      return hasAny(e.sizes, t) || advice ? null : 'size';
    case 'points':
      return hasAny(e.derived, t) ? null : 'points';
    case 'factor':
      return hasAny(e.derived, t) ? null : 'factor';
    case 'percent':
      if (metric) return null;
      if (!perf && (advice || hasAny(e.sizes, t) || hasAny(e.config, t))) return null;
      return 'percent';
    case 'decimal':
      if (metric) return null;
      if (!perf && (advice || hasAny(e.config, t) || hasAny(e.durations, t) || hasAny(e.sizes, t))) return null;
      return 'decimal';
    case 'integer': {
      if (perf) return metric ? null : 'integer';
      if (advice || hasAny(e.config, t) || hasAny(e.sizes, t) || hasAny(e.durations, t) || hasAny(e.seeds, t)) return null;
      // A small count in plain text ("two problems", "step 1") is not a result.
      return (t.value ?? 0) <= 10 ? null : 'integer';
    }
    default:
      return null;
  }
}

/** The problems in one sentence, or an empty list when it can stay. */
export function sentenceProblems(sentence: string, e: Evidence): ClaimKind[] {
  const kinds = tokens(sentence)
    .map((t) => checkToken(t, sentence, e))
    .filter((k): k is ClaimKind => !!k);
  // A comparison stated as fact needs a comparison in the run. One run record has no baseline to compare with.
  if (COMPARISON.test(sentence) && !HEDGE.test(sentence)) kinds.push('comparison');
  return [...new Set(kinds)];
}

export type Checked = { text: string; removed: number; kinds: ClaimKind[] };

/** Keeps every sentence whose claims are supported, and removes the others. It never adds a number. */
export function checkClaims(text: string, e: Evidence): Checked {
  const kinds = new Set<ClaimKind>();
  let removed = 0;
  const sentences = text.split(/(?<=[.!?])\s+(?=[^\s])/);
  const kept = sentences.filter((s) => {
    const p = sentenceProblems(s, e);
    p.forEach((k) => kinds.add(k));
    if (p.length) removed++;
    return !p.length;
  });
  return { text: kept.join(' ').trim(), removed, kinds: [...kinds] };
}
