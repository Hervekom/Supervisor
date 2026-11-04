export type AuditInput = {
  abstractEn: string;
  abstractOther: string;
  body: string;
  closing: string; // discussion and conclusion text
  references: string[];
  paragraphs?: string[]; // all text blocks, for labels and numbering
  year?: number;
};

export type AuditItem = { id: string; title: string; detail: string; examples: string[]; ok: boolean };

const sentences = (t: string) => t.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z])/);
const clip = (t: string, n = 150) => (t.length > n ? `${t.slice(0, n).trimEnd()}…` : t);
const normNum = (s: string) => String(Number(s.replace(/,/g, '')));
const uniq = <T,>(a: T[]) => [...new Set(a)];

const numbers = (t: string) => uniq((t.match(/\d+(?:\.\d+)?(?=\s*%)|\b\d+\.\d+\b/g) ?? []).map(normNum));
const names = (t: string) => uniq((t.match(/\b[A-Z]{2,}(?:[- ][A-Z]{2,})*[-]?\d{2,}\b/g) ?? []).map((s) => s.replace(/[- ]/g, '')));

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
    /\b(trained|training|stochastic|random)\b/i.test(a.body) && !/\bseed/i.test(a.body) && 'random seeds',
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
  const hits = sentences(`${a.body} ${a.closing}`).filter((s) => /\b(this (?:thesis|study|work|research|paper)|our (?:method|approach|model|framework|results?)|the proposed|we)\b.{0,80}\b(proves?|guarantees?|eliminates?|solves? (?:the|all)|perfect(?:ly)?|new paradigm)\b/i.test(s));
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
  const old = Math.round((years.filter((y) => y < year - 10).length / years.length) * 100);
  return {
    id: 'sources',
    title: 'How current are your sources?',
    ok: old <= 40,
    detail: `${a.references.length} references: ${share}% from the last five years, ${old}% older than ten. Keep foundational older work, and show you know the latest studies. Expectations differ by field.`,
    examples: [],
  };
}

const isEmpirical = (t: string) => /\b(experiments?|datasets?|survey|respondents?|evaluation|simulation)\b/i.test(t);

function abstractFocus(a: AuditInput): AuditItem | null {
  if (a.abstractEn.length < 200) return null;
  const t = a.abstractEn;
  const missing = [
    !/\b(however|yet|although|despite|challenge|problem|limitation|gap|vulnerab|difficult|lack)/i.test(t) && 'the problem',
    !/\b(propos|present|develop|design|introduc|investigat|examin|method|framework|approach)/i.test(t) && 'your method',
    !/\d|\b(results?|findings?|shows?|demonstrat|indicat)/i.test(t) && 'your main result',
    !/\b(contribut|novel|new|innovat|first|unlike|advance|significan)/i.test(t) && 'what is new',
  ].filter(Boolean) as string[];
  const first = sentences(t).slice(0, 3).join(' ');
  const late = !/\b(propos|present|develop|introduc|this (?:thesis|study|paper|work|research))/i.test(first);
  return {
    id: 'abstract_focus',
    title: 'Does your abstract lead with your main idea?',
    ok: !missing.length && !late,
    detail: missing.length ? `The abstract does not clearly state: ${missing.join(', ')}.` : late ? 'Your own work does not appear in the first three sentences. Committees often ask to move it up.' : 'It states the problem, method, result and what is new.',
    examples: [],
  };
}

function baselines(a: AuditInput): AuditItem | null {
  if (!/\b(experiments?|accuracy|f1|precision|benchmark|performance)\b/i.test(a.body)) return null;
  const n = (a.body.match(/\b(baselines?|state[- ]of[- ]the[- ]art|sota|compared (?:with|to|against)|comparative|comparison)\b/gi) ?? []).length;
  const enough = n >= Math.max(5, a.body.split(/\s+/).length / 2500);
  return {
    id: 'baselines',
    title: 'Do you compare with other methods?',
    ok: enough,
    detail: enough ? `Comparison language appears ${n} times. Confirm it includes recent published methods, not only simple baselines.` : 'There is little comparison with other methods. Committees often ask for it, including recent published work.',
    examples: [],
  };
}

function novelty(a: AuditInput): AuditItem {
  const t = `${a.abstractEn} ${a.closing}`;
  const stated = /\b(contributions?|novel|innovations?|unlike|differs? from|what is new)\b/i.test(t);
  return {
    id: 'novelty',
    title: 'Is it clear what is new in your work?',
    ok: stated,
    detail: stated ? 'You state a contribution. Check it separates your idea from what you reused.' : 'Neither the abstract nor the conclusion states your contribution. Say what you added that others had not.',
    examples: [],
  };
}

function designReasons(a: AuditInput): AuditItem | null {
  if (!isEmpirical(a.body)) return null;
  const n = (a.body.match(/\b(because|rationale|we chose|was chosen|were chosen|was selected|were selected|justif\w+|instead of|rather than)\b/gi) ?? []).length;
  const per = n / Math.max(1, a.body.split(/\s+/).length / 1000);
  return {
    id: 'design_reasons',
    title: 'Do you explain why you made each design choice?',
    ok: per >= 1,
    detail: per >= 1 ? 'Your text gives reasons for its choices. Be ready to defend each combination of methods.' : 'Few design choices are explained. Committees often ask why a method or combination was used.',
    examples: [],
  };
}

function interpretation(a: AuditInput): AuditItem | null {
  if (!isEmpirical(a.body)) return null;
  const heading = /\bdiscussion\b/i.test((a.paragraphs ?? []).filter((p) => p.length < 90).join(' ')) || /\d\.\d+\s+(?:\w+\s+){0,4}discussion\b/i.test(a.body);
  return {
    id: 'interpretation',
    title: 'Do you explain what your results mean?',
    ok: heading,
    detail: heading ? 'You have a discussion section. Check that it explains why results occurred, not only what they were.' : 'No discussion section was found. Committees reject chapters that only list results.',
    examples: [],
  };
}

function dataRealism(a: AuditInput): AuditItem | null {
  if (!/\bdatasets?\b/i.test(a.body)) return null;
  const weak = /\b(simulated|simulation|synthetic|private|proprietary|self-collected)\b/i.test(a.body);
  const open = /\b(public(?:ly)?(?: available)?|open[- ]source|benchmark|real-world)\b/i.test(a.body);
  return {
    id: 'data_realism',
    title: 'Would your data convince a sceptical reader?',
    ok: !weak || open,
    detail: weak && !open ? 'Your data appears to be simulated or private. Committees often ask for at least one public or real dataset.' : 'Explain why this dataset fits your problem, and name its limits.',
    examples: [],
  };
}

function labels(a: AuditInput): AuditItem | null {
  const blocks = a.paragraphs ?? [];
  if (!blocks.length) return null;
  const key = (m: RegExpMatchArray) => `${m[1][0].toUpperCase() === 'F' ? 'Figure' : 'Table'} ${m[2]}-${m[3]}`;
  const defined = new Set<string>();
  for (const b of blocks) {
    const m = b.match(/^(Figure|Fig\.?|Table)\s*(\d+)\s*[-.–]\s*(\d+)/i);
    if (m) defined.add(key(m));
  }
  if (!defined.size) return null;
  const cited = new Set<string>();
  for (const b of blocks) {
    for (const m of b.matchAll(/(?<!^)\b(Figure|Fig\.?|Table)\s*(\d+)\s*[-.–]\s*(\d+)/gi)) cited.add(key(m));
  }
  const missing = [...cited].filter((x) => !defined.has(x));
  const unused = [...defined].filter((x) => !cited.has(x));
  return {
    id: 'labels',
    title: 'Do figures and tables match the text?',
    ok: !missing.length && unused.length <= Math.ceil(defined.size * 0.2),
    detail: missing.length ? 'The text mentions labels that have no figure or table.' : unused.length ? `${unused.length} of ${defined.size} figures or tables are never mentioned in the text. Each one should make a point.` : 'Labels match the figures and tables.',
    examples: [...missing, ...unused].slice(0, 6),
  };
}

function citations(a: AuditInput): AuditItem | null {
  if (a.references.length < 5) return null;
  const used = new Set<number>();
  for (const m of a.body.matchAll(/\[(\d+(?:\s*[-–,]\s*\d+)*)\]/g)) {
    for (const part of m[1].split(',')) {
      const [x, y] = part.split(/[-–]/).map((v) => Number(v.trim()));
      if (y === undefined) used.add(x);
      else for (let i = x; i <= y && i - x < 300; i++) used.add(i);
    }
  }
  if (used.size < 3) return null;
  const total = a.references.length;
  const unused = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !used.has(n));
  const beyond = [...used].filter((n) => n > total);
  return {
    id: 'citations',
    title: 'Does every citation match your reference list?',
    ok: !beyond.length && unused.length <= Math.floor(total * 0.05),
    detail: beyond.length ? 'Some citations have no matching reference.' : unused.length ? `${unused.length} of ${total} references appear never to be cited.` : 'Citations and references match.',
    examples: [...beyond.map((n) => `Cited, not listed: [${n}]`), ...unused.slice(0, 5).map((n) => `Listed, not cited: [${n}]`)].slice(0, 6),
  };
}

export function auditThesis(a: AuditInput): AuditItem[] {
  return [abstractFocus(a), abstractsMatch(a), abstractInBody(a), novelty(a), comparisons(a), baselines(a), designReasons(a), interpretation(a), dataRealism(a), statistics(a), reproducible(a), labels(a), citations(a), questionsAnswered(a), limits(a), overclaims(a), sources(a)].filter((x): x is AuditItem => !!x);
}
