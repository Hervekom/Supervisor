import { describe, expect, it } from 'vitest';
import { checkClaims, evidenceOf, sentenceProblems, toNumber } from '@/lib/claims';
import { newRun, emptyDraft } from '@/lib/runs';

// A synthetic run. Every claim below is checked against it.
const run = newRun(
  {
    ...emptyDraft(),
    name: 'Full model, seed 42',
    dataset: 'Synthetic solar data, 12,000 rows',
    split: '70 / 15 / 15',
    model: 'LSTM with 2 layers',
    settings: 'lr 0.001, batch 64, 30 epochs',
    seeds: '42',
    versions: 'Python 3.12.7; PyTorch 2.9.0+cu128',
    hardware: 'One NVIDIA GPU',
    duration: '14 min',
    metrics: [
      { name: 'accuracy', value: 0.912, split: 'test' },
      { name: 'accuracy', value: 0.887, split: 'validation' },
      { name: 'RMSE', value: 12.4, split: 'test' },
    ],
  },
  '2026-11-09T10:00:00.000Z',
  'run-123456',
);
const e = evidenceOf(run);
const bad = (s: string) => expect(sentenceProblems(s, e), s).not.toEqual([]);
const ok = (s: string) => expect(sentenceProblems(s, e), s).toEqual([]);

describe('numbers in different notations', () => {
  it('reads thousands, decimal commas and plain numbers', () => {
    expect(toNumber('12,000')).toBe(12000);
    expect(toNumber('0,912')).toBe(0.912);
    expect(toNumber('91.2')).toBe(91.2);
    expect(toNumber('1.2.3')).toBeNull();
  });
});

describe('invented claims are removed', () => {
  it('integer claims', () => {
    bad('The model achieved 93 accuracy.');
    bad('Performance increased by 12 points.');
    bad('Your RMSE dropped to 11 on the test set.');
  });
  it('percentage claims', () => {
    bad('The new model improved accuracy by 15%.');
    bad('Expect about 95 % accuracy with more data.');
    bad('Le modèle a amélioré la précision de 15 %.');
  });
  it('decimal claims', () => {
    bad('A tuned model would reach 0.95 accuracy.');
    bad('The RMSE of 11.9 is low.');
    bad('La précision atteint 0,95.');
  });
  it('percentage-point and factor claims', () => {
    bad('The model outperformed the baseline by 8 percentage points.');
    bad('The new method is 3 times faster.');
    bad('It trains 2x faster than the baseline.');
  });
  it('comparisons with a baseline that the run does not contain', () => {
    bad('Your model outperforms the baseline.');
    bad('This method is better than the previous approach.');
    bad('Votre modèle surpasse la référence.');
  });
  it('seeds, dates and versions mistaken for results', () => {
    bad('Accuracy improved by 42%.'); // 42 is the seed
    bad('The model gained 11 points of accuracy.'); // 11 is the month
    bad('Accuracy rose by 2026.'); // the year
    bad('Accuracy reached 3.12.'); // part of the Python version
    bad('Your run used Python 3.11.4.'); // a version the student did not report
  });
  it('a duration or size that the student did not report', () => {
    bad('Your run took 20 minutes.');
    bad('The dataset has 50,000 rows.');
  });
});

describe('supported numbers and advice are kept', () => {
  it('numbers the student reported, in any notation', () => {
    ok('Test accuracy is 0.912.');
    ok('That is 91.2% accuracy on the test set.');
    ok('La précision sur le test est de 0,912.');
    ok('The RMSE of 12.4 is reported on the test set only.');
  });
  it('differences calculated between results of the same measure', () => {
    ok('Test accuracy is 2.5 percentage points above validation accuracy.');
    ok('The gap between test and validation accuracy is 0.025.');
  });
  it('seeds, versions, durations, sizes and settings in their own context', () => {
    ok('You used seed 42 only.');
    ok('The run used Python 3.12.7 and PyTorch 2.9.0+cu128.');
    ok('The run took 14 min on one GPU.');
    ok('The dataset has 12,000 rows split 70 / 15 / 15.');
    ok('A learning rate of 0.001 with batch 64 is a common start.');
  });
  it('methodological advice with numbers', () => {
    ok('Repeat the experiment with 3 seeds.');
    ok('Run 5 more seeds to report a mean and spread.');
    ok('Use 5 folds if the data is small.');
    ok('Train for at least 50 epochs before you compare.');
    ok('Répétez l’expérience avec 3 graines.');
    ok('Repeat it 3 times to get a better estimate.');
    ok('Report top-5 accuracy only if your field uses it.');
  });
  it('hedged comparisons, which state a limit rather than a result', () => {
    ok('One run cannot show that your model beats the baseline.');
    ok('You need a baseline before you can claim the model is better than other methods.');
    ok('Sans référence, vous ne pouvez pas affirmer que votre modèle surpasse les autres.');
  });
});

describe('cleaning a whole reply', () => {
  it('removes only the unsupported sentences and never adds a number', () => {
    const text = 'Test accuracy is 0.912 with one seed. The model is 3 times faster than the baseline. Repeat with 3 seeds.';
    const r = checkClaims(text, e);
    expect(r.text).toBe('Test accuracy is 0.912 with one seed. Repeat with 3 seeds.');
    expect(r.removed).toBe(1);
    expect(r.kinds).toEqual(['factor', 'comparison']);
    const added = [...r.text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0]).filter((n) => !text.includes(n));
    expect(added).toEqual([]);
  });
  it('keeps a fully supported reply unchanged', () => {
    const text = 'Only seed 42 was run, so the 0.912 test accuracy may be luck. Add a baseline and 2 more seeds.';
    expect(checkClaims(text, e)).toEqual({ text, removed: 0, kinds: [] });
  });
});
