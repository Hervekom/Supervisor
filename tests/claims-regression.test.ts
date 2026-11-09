import { describe, expect, it } from 'vitest';
import { checkClaims, classifyMetric, evidenceOf, joinThousands, matches, sentenceProblems } from '@/lib/claims';
import { normalizeRunFeedback } from '@/lib/runFeedback';
import { emptyDraft, newRun, type Metric } from '@/lib/runs';

// The B2.2 audit run: accuracy on two splits, RMSE, MAE and loss, seed 42. All data is synthetic.
const auditRun = newRun(
  {
    ...emptyDraft(),
    name: 'Full model, seed 42',
    dataset: 'Synthetic data, 12,000 rows',
    split: '70 / 15 / 15',
    settings: 'lr 0.001, batch 64, 30 epochs',
    seeds: '42',
    versions: 'Python 3.12.7',
    duration: '14 min',
    metrics: [
      { name: 'accuracy', value: 0.912, split: 'test' },
      { name: 'accuracy', value: 0.887, split: 'validation' },
      { name: 'RMSE', value: 12.4, split: 'test' },
      { name: 'MAE', value: 0.15, split: 'test' },
      { name: 'loss', value: 0.231, split: 'train' },
    ],
  },
  '2026-11-09T10:00:00.000Z',
  'run-123456',
);
const e = evidenceOf(auditRun);

type Case = [sentence: string, expected: 'keep' | 'remove', note: string];
/** The 43 statements from the B2.2 audit, with the expected outcome. */
const AUDIT: Case[] = [
  ['Test accuracy is 91.2%.', 'keep', 'accuracy 0.912 as a percentage'],
  ['MAE improved by 15%.', 'remove', 'MAE 0.15 is an error value'],
  ['The loss dropped by 23.1%.', 'remove', 'no comparable loss values'],
  ['RMSE is 1240%.', 'remove', 'RMSE is not a proportion'],
  ['The error rate is 15%.', 'remove', 'MAE is not an error rate'],
  ['Accuracy is 12.4.', 'remove', '12.4 is the RMSE'],
  ['RMSE is 0.912.', 'remove', '0.912 is accuracy'],
  ['Validation accuracy is 0.912.', 'remove', '0.912 is the test value'],
  ['Training loss is 0.231.', 'keep', 'correct metric and split'],
  ['Accuracy reached 93.', 'remove', ''],
  ['The model ranks 2nd among 5 methods.', 'remove', 'invented ranking'],
  ['The model improved on 4 of 5 tasks.', 'remove', 'invented count'],
  ['Test accuracy is 2.5 percentage points above validation.', 'keep', 'gap between splits of one metric'],
  ['That is a 2.8% relative improvement over validation.', 'remove', 'validation is not a baseline: an improvement needs one'],
  ['Test accuracy is about 91%.', 'keep', 'rounding of 91.2'],
  ['Accuracy is roughly 0.91.', 'keep', 'rounding of 0.912'],
  ['The model improves accuracy by 5 points over the baseline.', 'remove', ''],
  ['Your model outperforms the baseline.', 'remove', ''],
  ['The model outperforms the baseline, which is not surprising.', 'remove', 'the hedge is in another clause'],
  ['Your model is superior.', 'remove', ''],
  ['Accuracy is higher than the baseline.', 'remove', ''],
  ['This achieves state-of-the-art results.', 'remove', ''],
  ['It exceeds the previous method.', 'remove', ''],
  ['One run cannot show that your model beats the baseline.', 'keep', 'hedged'],
  ['Across seeds, mean accuracy is 0.90.', 'remove', 'only one run is reported'],
  ['With seed 42 accuracy was 0.912.', 'keep', ''],
  ['Accuracy improved by 42%.', 'remove', 'the seed is not a result'],
  ['La précision sur le test est de 0,912.', 'keep', ''],
  ['La précision a progressé de 15 %.', 'remove', ''],
  ['Le jeu contient 12 000 lignes.', 'keep', 'French thousands'],
  ['L’erreur MAE est de 0,15.', 'keep', ''],
  ['Le modèle est meilleur que la référence.', 'remove', ''],
  ['La précision est de 91,2 %.', 'keep', ''],
  ['Il est classé 2e sur 5 méthodes.', 'remove', ''],
  ['The results are statistically significant.', 'remove', 'no statistical test reported'],
  ['The model generalizes well to new data.', 'remove', ''],
  ['Accuracy is high.', 'keep', 'AMBIGUOUS: a judgement without numbers or a comparison; left to the prompt'],
  ['Use your 93% accuracy as the headline result.', 'remove', ''],
  ['Aim for an accuracy above 95%.', 'remove', 'AMBIGUOUS: a target, removed on purpose because it looks like a result'],
  ['Repeat the run with 3 seeds.', 'keep', ''],
  ['Since accuracy already beats the baseline, focus on speed.', 'remove', ''],
  ['Report the 0.912 test accuracy with its seed.', 'keep', ''],
  ['Run 5 more seeds; you should then see about 0.93.', 'remove', 'predicted result'],
];

/** New cases for this phase. */
const NEW: Case[] = [
  // Metric identity and split
  ['MAE is 0.15 on the test set.', 'keep', ''],
  ['The MAE is 15%.', 'remove', 'MAE is not a proportion'],
  ['Precision is 85%.', 'remove', 'no precision was reported'],
  ['Train accuracy is 0.912.', 'remove', 'wrong split'],
  ['Test RMSE is 12.4 and test accuracy is 0.912.', 'keep', ''],
  ['Test RMSE is 0.912.', 'remove', ''],
  // Rounding boundaries
  ['Test accuracy is 91.2 %.', 'keep', ''],
  ['Test accuracy is 90%.', 'remove', 'not a rounding of 91.2'],
  ['Test accuracy is 0.9.', 'remove', 'one significant digit is too coarse'],
  ['Test accuracy is 0.9120.', 'keep', 'more decimals of the same value'],
  ['Test accuracy is 0.913.', 'remove', 'not a rounding of 0.912'],
  // Predictions
  ['With more data, accuracy would reach 0.95.', 'remove', ''],
  ['Attendez-vous à une précision de 0,95.', 'remove', ''],
  ['You will get about 91% if you add augmentation.', 'remove', 'even a reported value is not a prediction'],
  // Qualitative claims
  ['The model is robust.', 'remove', ''],
  ['Your results do not yet show that the model is robust.', 'keep', 'hedged'],
  ['Les résultats sont statistiquement significatifs.', 'remove', ''],
  ['Le modèle généralise bien.', 'remove', ''],
  ['To claim state-of-the-art results, compare with published methods.', 'keep', 'hedged'],
  // Comparisons, French and English
  ['Le modèle dépasse la méthode précédente.', 'remove', ''],
  ['Test accuracy is higher than validation accuracy.', 'remove', 'AMBIGUOUS: a true fact about two reported values, removed because comparison wording needs a baseline'],
  ['Does your model beat the baseline?', 'keep', 'a question'],
];

function run(cases: Case[], ev = e) {
  const rows = cases.map(([s, want, note]) => {
    const got = sentenceProblems(s, ev).length ? 'remove' : 'keep';
    return { s, want, got, note, fp: want === 'keep' && got === 'remove', fn: want === 'remove' && got === 'keep' };
  });
  return { rows, fp: rows.filter((r) => r.fp), fn: rows.filter((r) => r.fn) };
}

describe('audit regression set', () => {
  it('has the 43 audit statements', () => {
    expect(AUDIT).toHaveLength(43);
  });
  it('gives the expected outcome for every audit statement', () => {
    const r = run(AUDIT);
    expect(r.fn.map((x) => x.s), 'false negatives').toEqual([]);
    expect(r.fp.map((x) => x.s), 'false positives').toEqual([]);
  });
  it('gives the expected outcome for every new statement', () => {
    const r = run(NEW);
    expect(r.fn.map((x) => x.s), 'false negatives').toEqual([]);
    expect(r.fp.map((x) => x.s), 'false positives').toEqual([]);
  });
  it('documents the cases that remain intentionally ambiguous', () => {
    const ambiguous = [...AUDIT, ...NEW].filter(([, , n]) => n.startsWith('AMBIGUOUS'));
    expect(ambiguous.map(([s]) => s)).toEqual(['Accuracy is high.', 'Aim for an accuracy above 95%.', 'Test accuracy is higher than validation accuracy.']);
  });
});

describe('metric classification', () => {
  it('converts only known proportions on a 0 to 1 scale', () => {
    expect(classifyMetric('accuracy', 0.912)).toMatchObject({ kind: 'proportion', scale: 'unit', direction: 'higher_is_better' });
    expect(classifyMetric('Accuracy', 91.2)).toMatchObject({ kind: 'proportion', scale: 'percent' });
    expect(classifyMetric('RMSE', 0.912)).toMatchObject({ kind: 'error', scale: 'raw', direction: 'lower_is_better' });
    expect(classifyMetric('MAE', 0.15)).toMatchObject({ kind: 'error', scale: 'raw' });
    expect(classifyMetric('val loss', 0.231)).toMatchObject({ kind: 'loss', scale: 'raw' });
    expect(classifyMetric('my_custom_score', 0.5)).toMatchObject({ kind: 'unknown', direction: 'unknown', scale: 'unknown' });
    expect(classifyMetric('MAPE', 12.3)).toMatchObject({ kind: 'error', scale: 'percent' });
  });
  it('never turns an unknown metric between 0 and 1 into a percentage', () => {
    const r = newRun({ ...emptyDraft(), name: 'x', metrics: [{ name: 'my_custom_score', value: 0.42, split: 'test' }] }, '2026-11-09T10:00:00.000Z', 'run-aaaaaa');
    const ev = evidenceOf(r);
    expect(sentenceProblems('My_custom_score is 42%.', ev)).not.toEqual([]);
    expect(sentenceProblems('My_custom_score is 0.42.', ev)).toEqual([]);
  });
});

describe('improvements need a baseline of the same measure and a known direction', () => {
  const metrics: Metric[] = [
    { name: 'accuracy', value: 0.912, split: 'test' },
    { name: 'baseline accuracy', value: 0.85, split: 'test' },
    { name: 'RMSE', value: 12.4, split: 'test' },
    { name: 'RMSE (baseline)', value: 15.5, split: 'test' },
    { name: 'my_score', value: 0.7, split: 'test' },
    { name: 'my_score baseline', value: 0.6, split: 'test' },
  ];
  const ev = evidenceOf(newRun({ ...emptyDraft(), name: 'With baselines', metrics }, '2026-11-09T10:00:00.000Z', 'run-bbbbbb'));
  it('accepts changes calculated from the baseline, in points or relative percent', () => {
    expect(sentenceProblems('Test accuracy improved by 6.2 percentage points over the baseline.', ev)).toEqual([]);
    expect(sentenceProblems('Test accuracy improved by 7.3% relative to the baseline.', ev)).toEqual([]);
    expect(sentenceProblems('RMSE dropped by 3.1 compared with the baseline.', ev)).toEqual([]);
    expect(sentenceProblems('RMSE dropped by 20% compared with the baseline.', ev)).toEqual([]);
  });
  it('refuses a change in the wrong direction or of the wrong size', () => {
    expect(sentenceProblems('RMSE increased by 3.1 compared with the baseline.', ev)).not.toEqual([]);
    expect(sentenceProblems('Test accuracy improved by 10 percentage points.', ev)).not.toEqual([]);
    expect(sentenceProblems('Accuracy dropped by 6.2 points.', ev)).not.toEqual([]);
  });
  it('does not call a higher value an improvement when the direction is unknown', () => {
    expect(sentenceProblems('My_score improved by 16.7% over the baseline.', ev)).not.toEqual([]);
    expect(sentenceProblems('My_score increased by 16.7% over the baseline.', ev)).toEqual([]);
  });
  it('keeps a factor only when it is the ratio of the baseline and the model', () => {
    expect(sentenceProblems('RMSE is 1.25 times lower than the baseline.', ev)).toEqual([]);
    expect(sentenceProblems('The model is 3 times faster than the baseline.', ev)).not.toEqual([]);
  });
  it('accepts a comparison stated as fact when the run holds a baseline result', () => {
    expect(sentenceProblems('The model outperforms the baseline on test accuracy.', ev)).toEqual([]);
  });
});

describe('rounding', () => {
  it('matches only real roundings that keep two significant digits', () => {
    expect(matches('91', 91, 91.2)).toBe(true);
    expect(matches('91.2', 91.2, 91.23)).toBe(true);
    expect(matches('0.91', 0.91, 0.912)).toBe(true);
    expect(matches('0.9', 0.9, 0.912)).toBe(false);
    expect(matches('92', 92, 91.2)).toBe(false);
    expect(matches('91', 91, 91.6)).toBe(false);
    expect(matches('2.8', 2.8, 2.818)).toBe(true);
    expect(matches('3', 3, 2.818)).toBe(false);
  });
});

describe('French numbers', () => {
  it('joins thousands written with spaces, and nothing else', () => {
    expect(joinThousands('12 000 lignes')).toBe('12000 lignes');
    expect(joinThousands('1 234 567 images')).toBe('1234567 images');
    expect(joinThousands('70 / 15 / 15')).toBe('70 / 15 / 15');
    expect(joinThousands('3 seeds')).toBe('3 seeds');
    expect(joinThousands('0,912 et 12 000')).toBe('0,912 et 12000');
  });
});

describe('statistical significance', () => {
  it('is accepted only when the run reports a statistical test', () => {
    const withTest = evidenceOf(newRun({ ...emptyDraft(), name: 't', notes: 'Paired t-test over 5 seeds, p < 0.01', metrics: [{ name: 'accuracy', value: 0.9, split: 'test' }] }, '2026-11-09T10:00:00.000Z', 'run-cccccc'));
    expect(sentenceProblems('The difference is statistically significant.', withTest)).toEqual([]);
    expect(sentenceProblems('The difference is statistically significant.', e)).toEqual(['qualitative']);
  });
});

describe('whole replies', () => {
  it('replaces unsupported qualitative claims with a plain statement, once, in the chosen language', () => {
    const fr = checkClaims('Le modèle est robuste. Il est aussi très robuste. Relancez avec 3 graines.', e, 'fr');
    expect(fr.text).toBe('Cette expérience seule ne montre pas la robustesse. Il faut des essais dans d’autres conditions ou sur d’autres données. Relancez avec 3 graines.');
    expect(fr.removed).toBe(2);
    expect(fr.text).not.toMatch(/\d(?! graines)/);
  });
  it('the audit reply is now cleaned', () => {
    const fb = normalizeRunFeedback({ summary: 'Accuracy is 12.4. The loss dropped by 23.1%.' }, auditRun);
    expect(fb.removed).toBe(2);
    expect(fb.summary).toBe('Part of this feedback was removed because it made a claim that could not be checked against your run.');
  });
});
