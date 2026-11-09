import { describe, expect, it } from 'vitest';
import { recordCheck, emptyLab } from '@/lib/lab';
import { verifyOutput } from '@/lib/labVerify';
import { applySituation, emptyPath, isPathState } from '@/lib/path';
import { decideSync, hasWork, samePath } from '@/lib/pathSync';
import { keepSubmittedNumbers, normalizeRunFeedback, RUN_SYSTEM, runMessages } from '@/lib/runFeedback';
import { cleanDraft, cleanRun, cleanRuns, emptyDraft, MAX_LOG, MAX_RUNS, newRun, numbersIn, parseMetricsFile, parseNumber, redact, runProblems, runToText, summarize, versionsFromLab, type RunDraft } from '@/lib/runs';

const T = '2026-11-09T10:00:00.000Z';
const draft = (over: Partial<RunDraft> = {}): RunDraft => ({ ...emptyDraft(), name: 'Baseline, seed 1', metrics: [{ name: 'accuracy', value: 0.912, split: 'test' }], ...over });

describe('run validation', () => {
  it('needs a name and a result, or a failed run with an explanation', () => {
    expect(runProblems(draft())).toEqual([]);
    expect(runProblems(draft({ name: '' }))).toContain('Give the run a name, for example "Baseline, seed 1".');
    expect(runProblems(draft({ metrics: [] }))).toContain('Add at least one result, or mark the run as failed.');
    expect(runProblems(draft({ metrics: [], outcome: 'failed' }))).toHaveLength(1);
    expect(runProblems(draft({ metrics: [], outcome: 'failed', notes: 'Out of memory at epoch 3' }))).toEqual([]);
  });
  it('rejects the same result twice on the same split', () => {
    expect(runProblems(draft({ metrics: [{ name: 'F1', value: 0.8, split: 'test' }, { name: 'f1', value: 0.7, split: 'test' }] }))[0]).toMatch(/appears twice/);
    expect(runProblems(draft({ metrics: [{ name: 'F1', value: 0.8, split: 'test' }, { name: 'F1', value: 0.7, split: 'validation' }] }))).toEqual([]);
  });
  it('drops results without a real number and trims long text', () => {
    const d = cleanDraft({ ...draft(), name: 'x'.repeat(500), log: 'y'.repeat(9000), metrics: [{ name: 'acc', value: Number.NaN, split: 'test' }, { name: 'acc', value: Infinity, split: 'test' }, { name: '', value: 1, split: 'test' }, { name: 'ok', value: 2, split: 'nonsense' as never }] });
    expect(d.name).toHaveLength(80);
    expect(d.log.length).toBeLessThanOrEqual(MAX_LOG);
    expect(d.metrics).toEqual([{ name: 'ok', value: 2, split: 'other' }]);
  });
  it('always labels a run as reported by the student', () => {
    const r = newRun(draft(), T, 'run-123456');
    expect(r.source).toBe('student');
    expect(runToText(r)).toMatch(/^Run: Baseline, seed 1 \(reported by the student, 2026-11-09\)/);
    expect(cleanRun({ ...r, source: 'measured' })!.source).toBe('student');
  });
});

describe('redaction', () => {
  it('hides user names, emails, addresses and secrets', () => {
    const { text, hidden } = redact('Saved to C:\\Users\\student\\proj and /home/student/x\nmail student@example.com from 10.0.0.12\nOPENAI_API_KEY=sk-abcdefghijklmnop1234 token: abc123');
    expect(text).toBe('Saved to C:\\Users\\[user]\\proj and /home/[user]/x\nmail [email] from [ip]\nOPENAI_API_KEY=[secret] token: [secret]');
    expect(hidden.sort()).toEqual(['email', 'ip', 'secret', 'user_path']);
  });
  it('keeps version numbers and results', () => {
    expect(redact('torch 2.9.0 CUDA Version: 12.7.1.2 acc=0.91').text).toBe('torch 2.9.0 CUDA Version: 12.7.1.2 acc=0.91');
  });
  it('is applied to every text field when a run is saved, and again when it is read back', () => {
    const r = newRun(draft({ log: 'loss 0.3 at /Users/student/run', notes: 'ask student@example.com', hardware: 'pc at 192.168.0.4' }), T, 'run-123456');
    expect(JSON.stringify(r)).not.toMatch(/student@|\/Users\/student|192\.168/);
    const tampered = cleanRun({ ...r, log: 'key sk-abcdefghijklmnop1234' })!;
    expect(tampered.log).toBe('key [secret]');
  });
});

describe('metrics files', () => {
  it('reads numbers with a dot, a comma or a percent sign, and nothing else', () => {
    expect(parseNumber('0.91')).toBe(0.91);
    expect(parseNumber('0,91')).toBe(0.91);
    expect(parseNumber('91%')).toBe(91);
    expect(parseNumber('1e-3')).toBe(0.001);
    for (const bad of ['', 'abc', '0.9.1', '91 percent', 'NaN', '1/2']) expect(parseNumber(bad), bad).toBeNull();
  });
  it('reads flat and nested JSON', () => {
    expect(parseMetricsFile('m.json', '{"accuracy": 0.91, "f1": "0.88", "note": "hi"}')).toEqual({ metrics: [{ name: 'accuracy', value: 0.91, split: 'other' }, { name: 'f1', value: 0.88, split: 'other' }], problems: ['"note" has no number and was skipped.'] });
    expect(parseMetricsFile('m.json', '{"test": {"accuracy": 0.9}, "val": {"accuracy": 0.92}}').metrics).toEqual([{ name: 'accuracy', value: 0.9, split: 'test' }, { name: 'accuracy', value: 0.92, split: 'validation' }]);
    expect(parseMetricsFile('m.json', '[{"name":"mae","value":1.5,"split":"test"}]').metrics).toEqual([{ name: 'mae', value: 1.5, split: 'test' }]);
  });
  it('reads long and wide CSV', () => {
    expect(parseMetricsFile('m.csv', 'metric,value,split\nRMSE,12.4,test\nMAE,8.1,validation\n').metrics).toEqual([{ name: 'RMSE', value: 12.4, split: 'test' }, { name: 'MAE', value: 8.1, split: 'validation' }]);
    expect(parseMetricsFile('m.csv', 'accuracy;f1\r\n0,91;0,88').metrics).toEqual([{ name: 'accuracy', value: 0.91, split: 'other' }, { name: 'f1', value: 0.88, split: 'other' }]);
  });
  it('refuses bad, large or unsupported files', () => {
    expect(parseMetricsFile('m.json', '{nope').problems).toEqual(['This JSON file could not be read.']);
    expect(parseMetricsFile('m.txt', 'a').problems).toEqual(['Choose a .csv or .json file.']);
    expect(parseMetricsFile('m.csv', 'x'.repeat(60_000)).problems[0]).toMatch(/50 KB/);
    expect(parseMetricsFile('m.csv', 'a,b\n1,2\n3,4').problems[0]).toMatch(/metric,value/);
    expect(parseMetricsFile('m.json', '{}').problems).toEqual(['No metrics were found in this file.']);
    expect(parseMetricsFile('m.json', JSON.stringify(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`m${i}`, i])))).metrics).toHaveLength(40);
  });
});

describe('summaries of repeated runs', () => {
  it('computes mean and sample standard deviation from reported values only', () => {
    const runs = [0.9, 0.92, 0.94].map((v, i) => newRun(draft({ name: `seed ${i}`, metrics: [{ name: 'accuracy', value: v, split: 'test' }] }), T, `run-00000${i}`));
    runs.push(newRun(draft({ name: 'crashed', outcome: 'failed', notes: 'OOM', metrics: [{ name: 'accuracy', value: 0.1, split: 'test' }] }), T, 'run-000009'));
    const [s] = summarize(runs);
    expect(s).toMatchObject({ name: 'accuracy', split: 'test', n: 3, min: 0.9, max: 0.94 });
    expect(s.mean).toBeCloseTo(0.92, 10);
    expect(s.sd).toBeCloseTo(0.02, 10);
  });
  it('gives no spread for a single run', () => {
    expect(summarize([newRun(draft(), T, 'run-123456')])[0].sd).toBeNull();
  });
});

describe('versions from the Lab', () => {
  it('uses only verified results for the same system', () => {
    let lab = recordCheck(emptyLab(), 'python', 'windows', verifyOutput('python', 'Python 3.12.7', { os: 'windows', gpu: 'no' }), T);
    lab = recordCheck(lab, 'git', 'windows', verifyOutput('git', 'nonsense', { os: 'windows', gpu: 'no' }), T);
    lab = recordCheck(lab, 'numpy', 'linux', verifyOutput('numpy', 'numpy 2.1.3', { os: 'linux', gpu: 'no' }), T);
    expect(versionsFromLab(lab, 'windows')).toBe('Python 3.12.7');
    expect(versionsFromLab(undefined, 'windows')).toBe('');
  });
});

describe('AI feedback on a run', () => {
  const run = newRun(draft({ metrics: [{ name: 'accuracy', value: 0.912, split: 'test' }, { name: 'RMSE', value: 12.4, split: 'validation' }], log: 'epoch 10 loss 0.231' }), T, 'run-123456');

  it('sends only the record, labelled, inside its own block', () => {
    const [sys, user] = runMessages(run, 'Fictional topic', 'French');
    expect(sys.content).toBe(RUN_SYSTEM);
    expect(sys.content).toMatch(/Never invent, estimate/);
    expect(user.content).toContain('Source: Reported by the student');
    expect(user.content).toContain('<run_record>');
    expect(user.content).toContain('accuracy (test) = 0.912');
  });

  it('knows every number the student submitted, including percentages', () => {
    const n = numbersIn(run);
    for (const x of [0.912, 91.2, 12.4, 0.231]) expect(n.has(x), String(x)).toBe(true);
    // The date of the run is not a result.
    expect(n.has(11)).toBe(false);
  });

  it('removes sentences that state numbers the student did not report', () => {
    const allowed = numbersIn(run);
    expect(keepSubmittedNumbers('Accuracy is 0.912 on test. A tuned model would reach 0.95. Try 3 more seeds.', allowed)).toEqual({ text: 'Accuracy is 0.912 on test. Try 3 more seeds.', removed: 1 });
    expect(keepSubmittedNumbers('That is 91.2% accuracy.', allowed).removed).toBe(0);
    expect(keepSubmittedNumbers('Expect about 93% next time.', allowed).removed).toBe(1);
  });

  it('cleans the whole reply and counts what it removed', () => {
    const fb = normalizeRunFeedback({ summary: 'One seed gave 0.912. Others report 0.97.', can_support: ['The RMSE of 12.4 on validation.', 'An improvement to 11.0 RMSE.'], cannot_support: 'not a list', missing: [1, 'Seeds'], next_action: 'Run seeds 2 and 3.' }, run);
    expect(fb).toEqual({ summary: 'One seed gave 0.912.', can_support: ['The RMSE of 12.4 on validation.'], cannot_support: [], missing: ['Seeds'], next_action: 'Run seeds 2 and 3.', removed: 2 });
  });
});

describe('PathState compatibility', () => {
  it('older copies without runs stay valid, and damaged runs are dropped', () => {
    expect(isPathState(emptyPath())).toBe(true);
    expect(cleanRuns(undefined)).toEqual([]);
    expect(cleanRuns([null, { id: 'x' }, { id: 'bad id!', createdAt: T, name: 'a' }, newRun(draft(), T, 'run-123456')])).toHaveLength(1);
    expect(cleanRuns(Array.from({ length: 60 }, (_, i) => newRun(draft(), T, `run-${String(i).padStart(6, '0')}`)))).toHaveLength(MAX_RUNS);
  });
  it('adding a run keeps every other part and is saved like any edit', () => {
    const base = { ...applySituation(emptyPath(), 'nothing', {}), savedAt: '2026-11-09T09:00:00Z' };
    const edited = { ...base, runs: [newRun(draft(), T, 'run-123456')], savedAt: T };
    const { runs, ...rest } = edited;
    expect({ ...rest, savedAt: base.savedAt }).toEqual(base);
    expect(runs).toHaveLength(1);
    expect(hasWork(edited)).toBe(true);
    expect(samePath(edited, base)).toBe(false);
    expect(decideSync(edited, { data: base, version: 'v1' }, { userId: 'u', version: 'v1', savedAt: base.savedAt }, 'u')).toBe('push');
  });
});
