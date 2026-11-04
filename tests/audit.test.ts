import { describe, expect, it } from 'vitest';
import { arithmeticIssues, auditThesis } from '@/lib/audit';

const base = { abstractEn: '', abstractOther: '', body: '', closing: '', references: [], year: 2026 };
const get = (i: Parameters<typeof auditThesis>[0], id: string) => auditThesis(i).find((x) => x.id === id);

describe('thesis audit', () => {
  it('finds a dataset that differs between abstracts', () => {
    const r = get({ ...base, abstractEn: 'Tested on CIC-IDS2018 with 92.4% accuracy.', abstractOther: '基于 CIC IDS2017 数据集，准确率 92.4%。' }, 'abstracts_match');
    expect(r?.ok).toBe(false);
    expect(r?.examples).toEqual(expect.arrayContaining(['CICIDS2018', 'CICIDS2017']));
  });
  it('accepts matching abstracts', () => {
    expect(get({ ...base, abstractEn: 'Accuracy of 92.40%.', abstractOther: '准确率 92.4%。' }, 'abstracts_match')?.ok).toBe(true);
  });
  it('finds abstract figures absent from the body', () => {
    expect(get({ ...base, abstractEn: 'We reach 88.1%.', body: 'The model reached 80.5% on the test set.' }, 'abstract_in_body')?.examples).toEqual(['88.1']);
  });
  it('recalculates an improvement claim', () => {
    const out = arithmeticIssues('The method reaches 66.5% accuracy. This is a 12.0% absolute improvement over the baseline (56.61%).');
    expect(out[0]).toMatch(/9\.89 points/);
    expect(out[0]).toMatch(/17\.5%/);
  });
  it('accepts correct points and correct relative gains', () => {
    expect(arithmeticIssues('We reach 60% accuracy, a 10% improvement over the baseline (50%).')).toEqual([]);
    expect(arithmeticIssues('We reach 60% accuracy, a 20% improvement over the baseline (50%).')).toEqual([]);
  });
  it('asks for the statistical details', () => {
    const r = get({ ...base, body: 'The gain is significant (p < 0.05), so it is not due to random chance.' }, 'statistics');
    expect(r?.ok).toBe(false);
    expect(r?.detail).toMatch(/name the statistical test/);
    expect(get({ ...base, body: 'No statistics here.' }, 'statistics')).toBeUndefined();
  });
  it('passes full statistics', () => {
    expect(get({ ...base, body: 'A paired t-test over 10 independent runs gave p < 0.01 with a 95% confidence interval of 1 to 2.' }, 'statistics')?.ok).toBe(true);
  });
  it('needs each research question answered', () => {
    const r = get({ ...base, body: 'RQ1 asks this. RQ2 asks that.', closing: 'RQ1 is answered here.' }, 'questions_answered');
    expect(r?.examples).toEqual(['RQ2']);
  });
  it('needs limitations and flags absolute claims', () => {
    expect(get({ ...base, closing: 'All went well.' }, 'limits')?.ok).toBe(false);
    expect(get({ ...base, closing: 'One limitation is scale.' }, 'limits')?.ok).toBe(true);
    expect(get({ ...base, body: 'This proves the method works everywhere. Another sentence follows.' }, 'overclaims')?.ok).toBe(false);
  });
  it('checks reproducibility only for empirical work', () => {
    expect(get({ ...base, body: 'A dataset was used.' }, 'reproducible')?.ok).toBe(false);
    expect(get({ ...base, body: 'This chapter reviews legal theory.' }, 'reproducible')).toBeUndefined();
  });
  it('reports source recency', () => {
    const refs = ['A 2025', 'B 2024', 'C 2023', 'D 2010', 'E 2022'];
    expect(get({ ...base, references: refs }, 'sources')?.detail).toMatch(/80%/);
  });
});
