export type AuditInput = {
  abstractEn: string;
  abstractOther: string;
  body: string;
  closing: string; // discussion and conclusion text
  references: string[];
  year?: number;
};

export type AuditItem = { id: string; title: string; detail: string; examples: string[]; ok: boolean };

const sentences = (t: string) => t.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z])/);
const clip = (t: string, n = 150) => (t.length > n ? `${t.slice(0, n).trimEnd()}…` : t);
const normNum = (s: string) => String(Number(s.replace(/,/g, '')));
const uniq = <T,>(a: T[]) => [...new Set(a)];

const numbers = (t: string) => uniq((t.match(/\d+(?:\.\d+)?(?=\s*%)|\b\d+\.\d+\b/g) ?? []).map(normNum));
const names = (t: string) => uniq((t.match(/[A-Z][A-Za-z]*(?:[- ][A-Z]+)*[- ]?\d{2,}\b/g) ?? []).map((s) => s.replace(/[- ]/g, '').toUpperCase()));

function abstractsMatch(a: AuditInput): AuditItem | null {
  if (!a.abstractEn || !a.abstractOther) return null;
  const n1 = numbers(a.abstractEn);
  const n2 = numbers(a.abstractOther);
  const t1 = names(a.abstractEn);
  const t2 = names(a.abstractOther);
  const diff = [...n1.filter((x) => !n2.includes(x)), ...n2.filter((x) => !n1.includes(x)), ...t1.filter((x) => !t2.includes(x)), ...t2.filter((x) => !t1.includes(x))];
  return {
    id: 'abstracts_match',
    title: 'Do both abstracts report the same facts?',
    ok: !diff.length,
    detail: diff.length ? 'These figures or names appear in one abstract but not in the other.' : 'Figures and named datasets match in both abstracts.',
    examples: diff.slice(0, 6),
  };
}

function abstractInBody(a: AuditInput): AuditItem | null {
  if (!a.abstractEn || !a.body) return null;
  const body = new Set(numbers(a.body));
  const missing = numbers(a.abstractEn).filter((n) => !body.has(n));
  return {
    id: 'abstract_in_body',
    title: 'Does every headline figure come from your results?',
    ok: !missing.length,
    detail: missing.length ? 'These abstract figures were not found in the main text.' : 'Each abstract figure also appears in the main text.',
    examples: missing.slice(0, 6),
  };
}

/** Recalculates sentences such as "... reaches 66.5%. This is a 12% absolute improvement over X (56.61%)". */
export function arithmeticIssues(body: string) {
  const text = body.replace(/\s+/g, ' ');
  const out: string[] = [];
  const re = /(\d+(?:\.\d+)?)%\s+(?:absolute\s+)?(?:improvement|increase|gain|advantage)\s+(?:over|on|compared (?:to|with))\s+[^()]{1,60}\((\d+(?:\.\d+)?)%\)/gi;
  for (const m of text.matchAll(re)) {
    const claim = Number(m[1]);
    const base = Number(m[2]);
    const before = text.slice(Math.max(0, (m.index ?? 0) - 220), m.index);
    const ours = (before.match(/\d+(?:\.\d+)?(?=\s*%)/g) ?? []).map(Number).filter((v) => v > base);
    if (!ours.length) continue;
    const value = ours[ours.length - 1];
    const points = value - base;
    const relative = (points / base) * 100;
    if (Math.abs(points - claim) > 0.3 && Math.abs(relative - claim) > 0.3) {
      out.push(`“${clip(m[0], 90)}”: from ${value}% and ${base}%, the gap is ${points.toFixed(2)} points, or ${relative.toFixed(1)}% in relative terms.`);
    }
  }
  return uniq(out);
}

function comparisons(a: AuditInput): AuditItem {
  const wrong = arithmeticIssues(`${a.abstractEn} ${a.body}`);
  const claims = sentences(a.body).filter((s) => /\b(outperform|improv|better than|higher than|lower than|reduc)\w*\b/i.test(s) && /\d\s*%/.test(s));
  const seen = uniq(claims).slice(0, 3).map((s) => clip(s));
  return {
    id: 'comparisons',
    title: 'Are your comparisons fair and correct?',
    ok: !wrong.length,
    detail: wrong.length
      ? 'These figures do not match when recalculated.'
      : `${claims.length} comparison ${claims.length === 1 ? 'sentence was' : 'sentences were'} found. Confirm each compares the same metric, under the same conditions, and says whether the gap is in points or percent.`,
    examples: wrong.length ? wrong.slice(0, 4) : seen,
  };
}

function statistics(a: AuditInput): AuditItem | null {
  const t = a.body;
  const hasP = /\bp\s*[<=>]\s*0?\.\d+/i.test(t);
  if (!hasP) return null;
  const hasTest = /t-test|anova|wilcoxon|chi-square|mann-whitney|regression|bootstrap/i.test(t);
  const hasN = /\b(\d+|ten|five|three|twenty|thirty)\s+(independent\s+|repeated\s+)?(runs|seeds|folds|trials|participants|respondents|samples)\b|\bn\s*=\s*\d+/i.test(t);
  const absolute = sentences(t).filter((s) => /not (?:due to|attributable to) (?:random )?(?:chance|variation)|proves? that/i.test(s));
  const gaps = [!hasTest && 'name the statistical test', !hasN && 'state how many runs or cases the test used', !/effect size|cohen|η2|confidence interval/i.test(t) && 'report an effect size or confidence interval'].filter(Boolean) as string[];
  return {
    id: 'statistics',
    title: 'Can a reader verify your statistics?',
    ok: !gaps.length && !absolute.length,
    detail: gaps.length ? `Add this next to your p-values: ${gaps.join(', ')}.` : absolute.length ? 'A p-value supports a result but does not rule out chance. Soften these sentences.' : 'The test, sample size and effect are all stated.',
    examples: absolute.slice(0, 2).map((s) => clip(s)),
  };
}

function reproducible(a: AuditInput): AuditItem | null {
  if (!/\b(experiment|dataset|simulation|trained)\b/i.test(a.body)) return null;
  const missing = [
    !/\bseed/i.test(a.body) && 'random seeds',
    !/\b(hyperparameter|learning rate|parameters? (?:were|was)|settings?)\b/i.test(a.body) && 'parameter settings',
    !/\b(github|gitlab|zenodo|code (?:is|are) available|data (?:is|are) available|available (?:at|from|on|upon))\b/i.test(a.body) && 'where to find the code and data',
  ].filter(Boolean) as string[];
  return {
    id: 'reproducible',
    title: 'Could someone repeat your work?',
    ok: !missing.length,
    detail: missing.length ? `Not found in the main text: ${missing.join(', ')}.` : 'Setup, seeds and availability are described.',
    examples: [],
  };
}

function questionsAnswered(a: AuditInput): AuditItem | null {
  const asked = uniq([...a.body.matchAll(/\bRQ\s?-?(\d)\b/g)].map((m) => m[1])).sort();
  if (!asked.length) return null;
  const unanswered = asked.filter((n) => !new RegExp(`\\bRQ\\s?-?${n}\\b`).test(a.closing));
  return {
    id: 'questions_answered',
    title: 'Does your conclusion answer each research question?',
    ok: !unanswered.length,
    detail: unanswered.length ? 'These questions are not named in the conclusion or discussion. Answer each one directly.' : 'Each research question returns in the closing chapters.',
    examples: unanswered.map((n) => `RQ${n}`),
  };
}

function limits(a: AuditInput): AuditItem {
  const has = /\b(limitations?|threats? to validity|shortcomings?)\b/i.test(a.closing);
  return {
    id: 'limits',
    title: 'Do you state the limits of your work?',
    ok: has,
    detail: has ? 'Your closing text discusses limitations. Check that each one affects how far your results can be applied.' : 'No limitations were found in your closing text. Reviewers expect them.',
    examples: [],
  };
}

function overclaims(a: AuditInput): AuditItem {
  const hits = sentences(`${a.body} ${a.closing}`).filter((s) => /\b(proves?|proven|impossible|perfectly|new paradigm)\b/i.test(s));
  return {
    id: 'overclaims',
    title: 'Are your claims as strong as your evidence?',
    ok: !hits.length,
    detail: hits.length ? `${hits.length} ${hits.length === 1 ? 'sentence uses' : 'sentences use'} absolute language. Check that your evidence supports it.` : 'No absolute claims were found.',
    examples: uniq(hits).slice(0, 3).map((s) => clip(s)),
  };
}

function sources(a: AuditInput): AuditItem | null {
  if (a.references.length < 5) return null;
  const year = a.year ?? new Date().getFullYear();
  const years = a.references.map((r) => [...r.matchAll(/\b(19\d\d|20[0-3]\d)\b/g)].map((m) => Number(m[1])).filter((y) => y <= year).pop()).filter((y): y is number => !!y);
  if (!years.length) return null;
  const recent = years.filter((y) => y >= year - 5).length;
  const share = Math.round((recent / years.length) * 100);
  return {
    id: 'sources',
    title: 'How current are your sources?',
    ok: true,
    detail: `${a.references.length} references, ${share}% from the last five years. Keep foundational older work, and show you know the latest studies. Expectations differ by field.`,
    examples: [],
  };
}

export function auditThesis(a: AuditInput): AuditItem[] {
  return [abstractsMatch(a), abstractInBody(a), comparisons(a), statistics(a), reproducible(a), questionsAnswered(a), limits(a), overclaims(a), sources(a)].filter((x): x is AuditItem => !!x);
}
