import { describe, expect, it } from 'vitest';
import { checkClaims, classifyMetric, evidenceOf, sentenceProblems, type ClaimKind } from '@/lib/claims';
import { emptyDraft, newRun, type Metric } from '@/lib/runs';

// B2.3.2: every numerical finding of the independent B2.3.1 audit, with English and French variants and boundaries.
// Expected outcomes were written from the mission's rules, before the fixes, not read off the implementation.
// All runs are synthetic.
const T = '2026-11-09T10:00:00.000Z';
const mk = (metrics: Metric[]) => evidenceOf(newRun({ ...emptyDraft(), name: 'Probe', seeds: '42', settings: 'lr 0.001, batch 64', dataset: 'Synthetic, 12,000 rows', duration: '14 min', metrics }, T, 'run-123456'));

// The same four runs as the B2.3.1 audit.
const A = mk([{ name: 'accuracy', value: 0.912, split: 'test' }, { name: 'accuracy', value: 0.887, split: 'validation' }, { name: 'precision', value: 0.85, split: 'test' }, { name: 'RMSE', value: 12.4, split: 'test' }, { name: 'loss', value: 0.231, split: 'train' }]);
const B = mk([{ name: 'accuracy', value: 0.912, split: 'test' }, { name: 'baseline accuracy', value: 0.85, split: 'test' }, { name: 'baseline_f1', value: 0.7, split: 'test' }, { name: 'f1', value: 0.78, split: 'test' }, { name: 'RMSE', value: 12.4, split: 'test' }, { name: 'RMSE baseline', value: 15.5, split: 'test' }]);
const C = mk([{ name: 'accuracy', value: 91.2, split: 'other' }, { name: 'MAPE', value: 0.12, split: 'other' }, { name: 'my_score', value: 0.5, split: 'other' }]);
const D = mk([{ name: 'accuracy', value: 0.996, split: 'test' }, { name: 'accuracy', value: 0.915, split: 'validation' }]);
// Extra runs for variants.
const U = mk([{ name: 'accuracy', value: 0.912, split: 'test' }, { name: 'acc_baseline', value: 0.85, split: 'test' }, { name: 'rmse', value: 12.4, split: 'test' }, { name: 'rmse_baseline', value: 15.5, split: 'test' }, { name: 'référence_f1', value: 0.7, split: 'test' }, { name: 'f1', value: 0.78, split: 'test' }]);
const S = mk([{ name: 'accuracy', value: 91.2, split: 'test' }, { name: 'MAPE (%)', value: 12, split: 'test' }]); // split chosen at import, scale explicit
const P = mk([{ name: 'accuracy', value: 1, split: 'test' }, { name: 'loss', value: 0, split: 'train' }]); // truly perfect values
const Z = mk([{ name: 'loss', value: 0.004, split: 'train' }]);
const V = mk([{ name: 'val_acc', value: 0.887, split: 'other' }]);

type Want = 'keep' | 'ambiguous' | ClaimKind | 'remove';
type Case = [string, ReturnType<typeof mk>, Want, string];

/** The 65 B2.3 cases live in claims-regression.test.ts. These are the 68 audit cases, then the new variants. */
const AUDIT: Case[] = [
  ['La précision est de 0,85.', A, 'keep', 'précision'],
  ['La précision sur le test est de 0,912.', A, 'ambiguous', 'précision may mean accuracy'],
  ['Precision is 0.912.', A, 'remove', 'précision'],
  ['Accuracy is 0.85.', A, 'remove', 'précision'],
  ['L’exactitude est de 0,85.', A, 'remove', 'précision'],
  ['The model scored 0.85.', A, 'ambiguous', 'generic'],
  ['Performance is 12.4.', A, 'ambiguous', 'generic'],
  ['The model reached 0.95.', A, 'remove', 'generic'],
  ['Overall the results look strong.', A, 'ambiguous', 'generic'],
  ['Test accuracy is 0.887.', A, 'remove', 'split'],
  ['Accuracy on the validation set is 0.887.', A, 'keep', 'split'],
  ['Held-out accuracy is 0.912.', A, 'keep', 'split'],
  ['Training accuracy is 0.912.', A, 'remove', 'split'],
  ['Test loss is 0.231.', A, 'remove', 'split'],
  ['Accuracy is 0.912 on the test set.', C, 'remove', 'split'],
  // N-FP1: the audit expected "keep"; the mission rules that an unknown split is never test evidence.
  ['Accuracy is 91.2% on the test set.', C, 'unknown_split', 'N-FP1'],
  // N-FP5: the audit expected "keep"; the mission rules that 0.12 is not assumed to mean 12%.
  ['MAPE is 12%.', C, 'unknown_scale', 'N-FP5'],
  ['My_score is 50%.', C, 'remove', 'scale'],
  ['Accuracy improved by 6.2 percentage points over the baseline.', B, 'keep', 'baseline'],
  ['Accuracy improved by 7.3% over the baseline.', B, 'keep', 'baseline'],
  ['Accuracy improved by 6.2% over the baseline.', B, 'remove', 'pp vs relative'],
  ['Accuracy improved by 7.3 percentage points.', B, 'remove', 'pp vs relative'],
  ['F1 improved by 8 points over the baseline.', B, 'keep', 'N-FP2 underscore baseline'],
  ['F1 improved by 11.4% over the baseline.', B, 'keep', 'N-FP3 underscore baseline'],
  ['RMSE fell by 3.1 compared with the baseline.', B, 'keep', 'baseline'],
  ['RMSE improved by 20%.', B, 'keep', 'baseline'],
  ['RMSE got worse by 20%.', B, 'remove', 'direction'],
  ['Accuracy fell by 6.2 points compared with the baseline.', B, 'remove', 'direction'],
  ['Accuracy is 7.3% higher than the baseline.', B, 'keep', 'baseline'],
  ['The model beats the baseline on accuracy.', B, 'keep', 'baseline'],
  ['The model beats the baseline on F1 by 0.08.', B, 'keep', 'N-FP4'],
  ['Test accuracy is 91%.', A, 'keep', 'rounding'],
  ['Test accuracy is 92%.', A, 'remove', 'rounding'],
  ['Test accuracy is 1.0.', D, 'remove', 'N-FN2'],
  ['Test accuracy is 100%.', D, 'remove', 'N-FN2'],
  ['Validation accuracy is 0.92.', D, 'ambiguous', 'half-up rounding'],
  ['RMSE is 12.', A, 'keep', 'rounding'],
  ['RMSE is about 10.', A, 'remove', 'rounding'],
  ['Test accuracy is higher than validation accuracy.', A, 'ambiguous', 'true, comparison wording'],
  ['Test accuracy is lower than validation accuracy.', A, 'remove', 'val/test'],
  ['Test accuracy is 2.5 points above validation accuracy.', A, 'keep', 'val/test'],
  ['Validation accuracy is 2.5 points above test accuracy.', A, 'remove', 'N-FN1'],
  ['Test accuracy improved by 2.5 points over validation.', A, 'remove', 'a split is not a baseline'],
  ['Add more data; accuracy should then reach 0.95.', A, 'remove', 'prediction'],
  ['Adding data should improve accuracy to about 0.95.', A, 'remove', 'prediction'],
  ['With augmentation, expect around 93%.', A, 'remove', 'prediction'],
  ['Ajoutez des données : vous devriez obtenir 0,95.', A, 'remove', 'prediction'],
  ['Re-run with 3 seeds to estimate the spread.', A, 'keep', 'advice'],
  ['Next run, aim for 0.95.', A, 'target', 'N-FN3'],
  ['Augmenter les données devrait améliorer la précision.', A, 'keep', 'no number'],
  ['The model is robustly accurate.', A, 'remove', 'robustly'],
  ['The model clearly overfits.', A, 'ambiguous', 'not in the list'],
  ['The results are reliable.', A, 'ambiguous', 'not in the list'],
  ['This is a significant improvement.', A, 'remove', 'qualitative'],
  ['Le modèle montre une bonne robustesse.', A, 'remove', 'qualitative'],
  ['Les résultats sont à l’état de l’art.', A, 'remove', 'qualitative'],
  ['Your run does not show robustness yet.', A, 'keep', 'hedged'],
  ['Although the model beats the baseline, more seeds are needed.', A, 'remove', 'concession'],
  ['If the model beats the baseline, report it.', A, 'keep', 'hedge'],
  ['It does not just beat the baseline, it crushes it.', A, 'comparison', 'N-FN5'],
  ['The model is better than the baseline, but more seeds are needed.', A, 'remove', 'hedge'],
  ['You cannot yet say the model is better than the baseline.', A, 'keep', 'hedge'],
  ['Le modèle, qui surpasse la référence, est simple.', A, 'remove', 'hedge'],
  ['Vous ne pouvez pas encore affirmer que le modèle surpasse la référence.', A, 'keep', 'hedge'],
  ['Bien que le modèle surpasse la référence, il faut plus de graines.', A, 'remove', 'hedge'],
  ['Le modèle ne dépasse pas la référence.', A, 'ambiguous', 'negative comparison'],
  ['Results are better than expected.', A, 'ambiguous', 'not a baseline'],
  ['Accuracy is higher than 0.9.', A, 'ambiguous', 'threshold'],
];

const VARIANTS: Case[] = [
  // N-FP1: unknown split, English and French, and the fix at import.
  ['L’exactitude sur le jeu de test est de 91,2 %.', C, 'unknown_split', 'N-FP1 fr'],
  ['Validation accuracy is 91.2%.', C, 'unknown_split', 'N-FP1 validation'],
  ['Training accuracy is 91.2%.', C, 'unknown_split', 'N-FP1 train'],
  ['Accuracy is 91.2%.', C, 'keep', 'no split named, value reported'],
  ['Test accuracy is 95%.', C, 'remove', 'wrong value is not an unknown-split case'],
  ['Accuracy is 91.2% on the test set.', S, 'keep', 'split chosen at import'],
  ['Validation accuracy is 91.2%.', S, 'remove', 'split chosen at import, other split'],
  // N-FP2/3: baseline names with underscores, English and French.
  ['Accuracy improved by 6.2 points over the baseline.', U, 'keep', 'acc_baseline'],
  ['RMSE fell by 3.1 compared with the baseline.', U, 'keep', 'rmse_baseline'],
  ['RMSE improved by 20% over the baseline.', U, 'keep', 'rmse_baseline relative'],
  ['Le F1 s’améliore de 8 points par rapport à la référence.', U, 'keep', 'référence_f1'],
  ['F1 improved by 9 points over the baseline.', U, 'remove', 'wrong difference'],
  ['Validation accuracy is 0.887.', V, 'keep', 'val_acc name gives the split'],
  ['Test accuracy is 0.887.', V, 'remove', 'val_acc is validation'],
  // N-FN1: direction of split gaps.
  ['L’exactitude de test est 2,5 points au-dessus de la validation.', A, 'keep', 'fr right direction'],
  ['L’exactitude de validation est 2,5 points au-dessus de celle du test.', A, 'remove', 'fr wrong direction'],
  ['Validation accuracy is 2.5 points below test accuracy.', A, 'keep', 'below, right direction'],
  ['Test accuracy is 2.5 points below validation accuracy.', A, 'remove', 'below, wrong direction'],
  ['The gap between test and validation accuracy is 2.5 points.', A, 'keep', 'absolute gap, no direction'],
  ['Test accuracy is 3 points above validation accuracy.', A, 'remove', 'wrong size'],
  // N-FN2: perfect and zero boundaries.
  ['L’exactitude sur le test est de 100 %.', D, 'remove', 'fr 100%'],
  ['Test accuracy is 1.', D, 'remove', 'one digit'],
  ['Test accuracy is 99.6%.', D, 'keep', 'exact'],
  ['Test accuracy is 0.996.', D, 'keep', 'exact'],
  ['Test accuracy is 100%.', P, 'keep', 'truly perfect'],
  ['Test accuracy is 1.0.', P, 'keep', 'truly perfect'],
  ['Training loss is 0.0.', Z, 'remove', 'zero boundary'],
  ['Training loss is 0.004.', Z, 'keep', 'exact'],
  ['Training loss is 0.', P, 'keep', 'truly zero'],
  // N-FN3: targets.
  ['Visez 0,95 au prochain essai.', A, 'target', 'fr target'],
  ['Next time, target 93% accuracy.', A, 'remove', 'target with a metric'],
  ['As a hypothetical target, aim for 0.95.', A, 'keep', 'labelled hypothetical'],
  ['Par exemple, visez une exactitude de 0,95 comme objectif hypothétique.', A, 'keep', 'fr labelled hypothetical'],
  ['Aim for at least 3 seeds.', A, 'keep', 'procedure, not a result'],
  // N-FN5: rhetorical comparisons and negation.
  ['Not only does it beat the baseline, it is far ahead.', A, 'comparison', 'not only'],
  ['Le modèle ne fait pas que battre la référence, il l’écrase.', A, 'comparison', 'fr rhetorical'],
  ['Non seulement le modèle surpasse la référence, mais il la domine.', A, 'comparison', 'fr non seulement'],
  ['The model does not outperform the baseline.', A, 'comparison', 'negation is still a comparison'],
  ['You cannot yet say whether it beats the baseline.', A, 'keep', 'doubt is a hedge'],
  ['Il faudrait une référence pour savoir si le modèle la dépasse.', A, 'keep', 'fr doubt'],
  // N-FP4: difference wording.
  ['Accuracy beats the baseline by 6.2 points.', B, 'keep', 'beats by points'],
  ['The model beats the baseline on F1 by 0.09.', B, 'remove', 'wrong size'],
  ['Le modèle bat la référence de 0,08 en F1.', B, 'keep', 'fr bat de'],
  ['The baseline beats the model on F1 by 0.08.', B, 'remove', 'wrong direction'],
  ['The model outperforms the baseline on RMSE by 3.1.', B, 'keep', 'lower is better'],
  // N-FP5: MAPE scale.
  ['MAPE is 0.12.', C, 'keep', 'raw value'],
  ['Le MAPE est de 12 %.', C, 'unknown_scale', 'fr'],
  ['MAPE is 12%.', S, 'keep', 'explicit % in the name'],
  ['MAPE is 0.12%.', C, 'remove', 'not shown as a fraction either'],
];

const verdict = (got: ClaimKind[], want: Want) => {
  if (want === 'keep') return got.length === 0;
  if (want === 'remove') return got.length > 0;
  return got.includes(want as ClaimKind);
};

describe('B2.3.2 numerical regression', () => {
  const report = { fp: [] as string[], fn: [] as string[], ambiguous: [] as string[] };
  for (const [s, e, want, why] of [...AUDIT, ...VARIANTS]) {
    if (want === 'ambiguous') {
      it(`records an ambiguous case: ${s}`, () => {
        const got = sentenceProblems(s, e);
        report.ambiguous.push(`${got.length ? 'removed' : 'kept'}: ${s} (${why})`);
      });
      continue;
    }
    it(`${want}: ${s} (${why})`, () => {
      const got = sentenceProblems(s, e);
      if (!verdict(got, want)) (want === 'keep' ? report.fp : report.fn).push(s);
      expect(verdict(got, want), JSON.stringify(got)).toBe(true);
    });
  }
  it('counts', () => {
    expect(AUDIT).toHaveLength(68);
    expect(VARIANTS.length).toBeGreaterThanOrEqual(45);
    expect(report.fp).toEqual([]);
    expect(report.fn).toEqual([]);
    expect(report.ambiguous).toHaveLength(11);
  });
});

describe('metric names and scale', () => {
  it('recognises baselines written with underscores, without catching unrelated names', () => {
    const roles = (names: string[]) => mk(names.map((name) => ({ name, value: 0.5, split: 'test' as const }))).metrics.map((m) => `${m.base}:${m.role}`);
    expect(roles(['baseline_f1', 'acc_baseline', 'baseline_accuracy', 'rmse_baseline', 'f1_référence', 'accuracy_ref'])).toEqual(['f1:baseline', 'accuracy:baseline', 'accuracy:baseline', 'rmse:baseline', 'f1:baseline', 'accuracy:baseline']);
    expect(roles(['preference_score', 'refined_score', 'baselines_count', 'my_score'])).toEqual(['preference score:model', 'refined score:model', 'baselines count:model', 'my score:model']);
  });
  it('keeps the scale of MAPE unknown unless it is shown', () => {
    expect(classifyMetric('MAPE', 0.12).scale).toBe('unknown');
    expect(classifyMetric('MAPE', 12).scale).toBe('percent');
    expect(classifyMetric('MAPE (%)', 0.12).scale).toBe('percent');
  });
});

describe('the student is told why a claim cannot be checked', () => {
  it('reports the unknown split and the unknown scale as their own kinds', () => {
    const r = checkClaims('Accuracy is 91.2% on the test set. MAPE is 12%. Accuracy is 91.2%.', C);
    expect(r.removed).toBe(2);
    expect(r.kinds.sort()).toEqual(['unknown_scale', 'unknown_split']);
    expect(r.text).toBe('Accuracy is 91.2%.');
  });
});
