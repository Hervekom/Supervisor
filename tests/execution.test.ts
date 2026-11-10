import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cleanExecution, detectErrors, emptyEvidence, inputProblem, MAX_PASTE, MAX_TASKS, metricLines, newTask, prepareSteps, runFromTask,
  sameValue, submitEvidence, suggestTasks, TEMPLATES, TEMPLATES_BY_ID, trimLog, typedMetrics, type Evidence, type ExecTask,
} from '@/lib/execution';
import { emptyLab } from '@/lib/lab';
import { verifyOutput } from '@/lib/labVerify';
import { selectTools } from '@/lib/software';
import { loadCatalogue } from '@/lib/softwareCatalog';
import { STEPS } from '@/lib/path';

// Phase P9. Every output below is the real output of the provided scripts on synthetic data (e2e/exec-fixtures).
const fx = (n: string) => readFileSync(`e2e/exec-fixtures/${n}`, 'utf8');
const ev = (p: Partial<Evidence>): Evidence => ({ ...emptyEvidence(), ...p });
const task = (template: string, inputs: Record<string, string> = {}): ExecTask => ({ ...newTask(template, undefined, '2026-11-10T08:00:00.000Z', 'task-synthetic-0001'), inputs });
const run = (template: string, e: Partial<Evidence>, inputs: Record<string, string> = {}, os: 'windows' | 'macos' | 'linux' = 'linux') => {
  const r = submitEvidence(task(template, inputs), ev(e), { os });
  if (!r.ok) throw new Error(r.problem);
  return r.task.review!;
};
const catalogue = loadCatalogue();
const ids = (t: { id: string }[]) => t.map((x) => x.id);

describe('setup adapts to the methodology', () => {
  const sel = (workTypes: string[], gpu: 'yes' | 'no' | 'not_sure' = 'not_sure', os: 'windows' | 'macos' | 'linux' = 'windows') => ids(selectTools(catalogue, { workTypes: workTypes as never, os, gpu }));
  it('qualitative research gets no programming tools', () => {
    expect(sel(['qualitative'])).toEqual(['taguette']);
  });
  it('statistics in R gets R and RStudio, not Python', () => {
    expect(sel(['statistics_r'])).toEqual(['git', 'r', 'rstudio']);
  });
  it('solar forecasting with deep learning gets Python, PyTorch and the GPU card only when a GPU is possible', () => {
    const dl = sel(['deep_learning', 'data_science'], 'yes');
    expect(dl).toEqual(expect.arrayContaining(['python', 'venv', 'numpy', 'pandas', 'pytorch', 'nvidia-gpu']));
    expect(sel(['deep_learning', 'data_science'], 'no')).not.toContain('nvidia-gpu');
    expect(sel(['deep_learning'], 'not_sure', 'macos')).not.toContain('nvidia-gpu'); // NVIDIA guidance is not for macOS
    expect(dl).not.toContain('r');
  });
  it('simulation gets SciPy; statistics in Python gets statsmodels; mixed projects get both ecosystems', () => {
    expect(sel(['simulation'])).toEqual(expect.arrayContaining(['python', 'numpy', 'scipy']));
    expect(sel(['simulation'])).not.toContain('pandas');
    expect(sel(['statistics'])).toContain('statsmodels');
    expect(sel(['statistics_r', 'qualitative'])).toEqual(['git', 'r', 'rstudio', 'taguette']);
    expect(sel(['statistics_r', 'machine_learning'])).toEqual(expect.arrayContaining(['python', 'scikit-learn', 'r']));
  });
});

describe('R and the visual checks', () => {
  it('accepts the line R prints, and explains a terminal by mistake', () => {
    expect(verifyOutput('r', fx('rversion.txt'), { os: 'linux', gpu: 'no' })).toEqual({ status: 'verified', found: 'R 4.3.3', reason: 'ok' });
    expect(verifyOutput('r', "'R.version.string' is not recognized as an internal or external command,", { os: 'windows', gpu: 'no' }).reason).toBe('r_in_terminal');
    expect(verifyOutput('r', '[1] "R version 3.6.3 (2020-02-29)"', { os: 'windows', gpu: 'no' })).toMatchObject({ status: 'manual_review', reason: 'r_old' });
    expect(verifyOutput('r', 'Python 3.12.7', { os: 'windows', gpu: 'no' }).status).toBe('failed');
  });
  it('RStudio and Taguette are checked by looking, never verified automatically', () => {
    for (const id of ['rstudio', 'taguette']) {
      const e = catalogue.find((x) => x.id === id)!;
      expect(e.verify_manual).toBeTruthy();
      expect(e.verify).toEqual({});
      expect(verifyOutput(id, 'anything', { os: 'linux', gpu: 'no' }).status).toBe('manual_review');
    }
  });
  it('every command in a task is written for the system it is shown on', () => {
    for (const t of TEMPLATES)
      for (const os of t.os ?? (['windows', 'macos', 'linux'] as const)) {
        const cmds = [...prepareSteps(t.env, os), ...t.execute({}, os)].map((s) => s.command).filter(Boolean) as string[];
        for (const c of cmds) {
          if (os === 'windows') expect(c, `${t.id} ${os}`).not.toMatch(/^source |python3|\/bin\//);
          else expect(c, `${t.id} ${os}`).not.toMatch(/\\Scripts\\|^py /);
          expect(c).not.toMatch(/\r|\n|sudo|curl|wget|rm /);
        }
      }
    expect(TEMPLATES_BY_ID['gpu-check'].os).toEqual(['windows', 'linux']);
  });
});

describe('tasks are linked to thesis steps and methodologies', () => {
  it('uses only existing step ids, and each task has the ten parts of a task', () => {
    const steps = new Set(STEPS.map((s) => s.id));
    for (const t of TEMPLATES) {
      for (const s of t.steps) expect(steps.has(s), `${t.id} ${s}`).toBe(true);
      expect(t.objective.en && t.objective.fr && t.why.en && t.config.en && t.expected.fr).toBeTruthy();
      expect(t.criteria.length && t.risks.length && t.evidence.length).toBeTruthy();
      for (const x of t.tools) expect(catalogue.some((e) => e.id === x), `${t.id} ${x}`).toBe(true);
    }
  });
  it('suggests only what fits', () => {
    const lab = (workTypes: string[], gpu: 'yes' | 'no' | 'not_sure', os: 'windows' | 'macos' | 'linux' = 'windows') => ({ ...emptyLab(), workTypes: workTypes as never, gpu, os });
    expect(ids(suggestTasks(lab(['qualitative'], 'no')))).toEqual(['qualitative-coding']);
    expect(ids(suggestTasks(lab(['statistics_r'], 'no')))).toEqual(['dataset-check-r', 'regression-r']);
    const solar = ids(suggestTasks(lab(['deep_learning', 'data_science'], 'yes')));
    expect(solar).toEqual(expect.arrayContaining(['dataset-check', 'experiment', 'gpu-check', 'gpu-experiment', 'environment-snapshot']));
    expect(ids(suggestTasks(lab(['deep_learning'], 'no')))).not.toContain('gpu-check');
    expect(ids(suggestTasks(lab(['deep_learning'], 'yes', 'macos')))).not.toContain('gpu-experiment');
    expect(ids(suggestTasks(lab(['deep_learning'], 'yes'), 'experiments'))).not.toContain('dataset-check-r');
  });
  it('inputs that go into commands must be plain names', () => {
    const f = TEMPLATES_BY_ID['regression-r'].inputs;
    expect(inputProblem(f[0], 'data/wages.csv')).toBeNull();
    expect(inputProblem(f[0], 'data/x.csv; rm -rf ~')).toBe('unsafe');
    expect(inputProblem(f[0], '../../secret.csv')).toBe('unsafe');
    expect(inputProblem(f[1], 'wage ~ education + experience')).toBeNull();
    expect(inputProblem(f[1], 'wage ~ x"); system("calc')).toBe('unsafe');
    expect(inputProblem(f[1], '')).toBe('missing');
    // An unsafe value is never placed in the command: the placeholder is shown instead.
    const body = TEMPLATES_BY_ID['regression-r'].execute({ file: 'a.csv"); system("x', formula: 'y ~ x' }, 'linux')[0].code!.body;
    expect(body).toContain('read.csv("data/my_data.csv")');
  });
});

describe('dataset checks', () => {
  it('a clean file is verified, with what was found', () => {
    const r = run('dataset-check', { output: fx('dataset-ok.txt') }, { file: 'data/solar.csv', rows: '240', columns: 'timestamp, ghi', date: 'timestamp' });
    expect(r.status).toBe('verified');
    expect(r.found).toEqual(expect.arrayContaining([['rows', '240'], ['missing values', '0'], ['first date', '2025-01-01 00:00:00']]));
  });
  it('missing values, a duplicate and a bad date need review; a wrong row count or column is incomplete', () => {
    expect(run('dataset-check', { output: fx('dataset-messy.txt') }, { file: 'data/solar.csv', date: 'timestamp' })).toMatchObject({ status: 'needs_review', reasons: ['missing_values', 'duplicates', 'bad_dates'] });
    expect(run('dataset-check', { output: fx('dataset-ok.txt') }, { file: 'data/solar.csv', rows: '8760' })).toMatchObject({ status: 'incomplete', reasons: ['rows_differ:8760'] });
    expect(run('dataset-check', { output: fx('dataset-ok.txt') }, { file: 'data/solar.csv', columns: 'ghi, dni' }).reasons).toEqual(['columns_missing:dni']);
  });
  it('a missing file fails with the reason; unrelated text is not accepted', () => {
    expect(run('dataset-check', { output: fx('dataset-nofile.txt') }, { file: 'data/missing.csv' })).toMatchObject({ status: 'failed', reasons: ['err_file'] });
    expect(run('dataset-check', { output: 'I ran it and it worked fine.' }, { file: 'data/solar.csv' }).status).toBe('incomplete');
    expect(run('dataset-check', {}, { file: 'data/solar.csv' })).toMatchObject({ status: 'incomplete', reasons: ['no_output'] });
  });
  it('the R version reads the same way', () => {
    expect(run('dataset-check-r', { output: fx('dataset-r.txt') }, { file: 'data/solar.csv', rows: '240' }).status).toBe('verified');
  });
});

describe('experiments', () => {
  const inputs = { script: 'train.py', metrics: 'rmse, mae' };
  const config = 'seed: 7\nsplit: first 80% train, last 20% test\nmodel: linear baseline';
  it('a documented run needs a scientific review: it is never marked a success', () => {
    const r = run('experiment', { output: fx('train.txt'), config, metrics: 'rmse = 314.36, mae 284.85' }, inputs);
    expect(r.status).toBe('needs_review');
    expect(r.metrics).toEqual([{ name: 'rmse', value: 314.35841662794485 }, { name: 'mae', value: 284.8467640244237 }]);
    expect(r.found).toEqual(expect.arrayContaining([['seed', '7'], ['device', 'cpu']]));
  });
  it('typed numbers that disagree with the log, a missing metric, seed or configuration make it incomplete', () => {
    expect(run('experiment', { output: fx('train.txt'), config, metrics: 'rmse = 120.5' }, inputs).reasons).toEqual(['metric_mismatch:rmse']);
    expect(run('experiment', { output: fx('train.txt'), config, metrics: 'r2 = 0.95' }, inputs).reasons).toEqual(['metric_not_in_log:r2']);
    expect(run('experiment', { output: fx('train.txt'), config }, { ...inputs, metrics: 'rmse, mae, skill' }).reasons).toEqual(['metrics_missing:skill']);
    expect(run('experiment', { output: fx('train.txt').replace('SEED=7\n', '') }, inputs).reasons).toEqual(['no_seed', 'no_config']);
    expect(run('experiment', { output: 'epoch 1 done\nepoch 2 done' , config }, inputs).reasons).toEqual(['no_seed', 'no_device', 'no_metrics', 'metrics_missing:rmse, mae']);
  });
  it('a GPU training must have run on CUDA; out of memory is explained', () => {
    expect(run('gpu-experiment', { output: fx('train.txt'), config }, inputs, 'windows')).toMatchObject({ status: 'failed', reasons: ['not_on_gpu'] });
    expect(run('gpu-experiment', { output: fx('train.txt').replace('DEVICE=cpu', 'DEVICE=cuda:0'), config }, inputs, 'windows').status).toBe('needs_review');
    const oom = 'epoch 1\nTraceback (most recent call last):\n  File "train.py", line 40\ntorch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.00 GiB';
    expect(run('gpu-experiment', { output: oom }, inputs, 'linux')).toMatchObject({ status: 'failed', reasons: ['err_cuda_oom'] });
  });
  it('a reviewed run becomes a run record with the printed numbers only', () => {
    const r = submitEvidence(task('experiment', inputs), ev({ output: fx('train.txt'), config }), { os: 'linux' });
    const d = runFromTask((r as { task: ExecTask }).task)!;
    expect(d.metrics.map((m) => m.value)).toEqual([314.35841662794485, 284.8467640244237]);
    expect(d).toMatchObject({ seeds: '7', hardware: 'cpu', settings: config, stepId: 'experiments' });
    expect(runFromTask(task('experiment', inputs))).toBeNull(); // nothing submitted, nothing to save
  });
});

describe('GPU check', () => {
  const smi = '+-----------------------------------------------------------------------------------------+\n| NVIDIA-SMI 566.14                 Driver Version: 566.14         CUDA Version: 12.7     |';
  it('verified only with the driver and cuda True', () => {
    expect(run('gpu-check', { output: `${smi}\ntorch 2.9.0+cu128 cuda True\nGPU=NVIDIA GeForce RTX 4060` }, {}, 'windows')).toMatchObject({ status: 'verified', reasons: ['gpu_ready'] });
    expect(run('gpu-check', { output: `${smi}\ntorch 2.9.0+cpu cuda False\nGPU=none` }, {}, 'windows').reasons).toEqual(['torch_cpu_build']);
    expect(run('gpu-check', { output: `${smi}\ntorch 2.9.0+cu128 cuda False\nGPU=none` }, {}, 'linux').reasons).toEqual(['torch_no_cuda']);
    expect(run('gpu-check', { output: "'nvidia-smi' is not recognized as an internal or external command" }, {}, 'windows')).toMatchObject({ status: 'failed', reasons: ['err_command'] });
    expect(run('gpu-check', { output: 'torch 2.9.0+cu128 cuda True' }, {}, 'linux').reasons).toEqual(['no_smi']);
  });
});

describe('statistics, simulation, qualitative and versions', () => {
  it('regressions in R and statsmodels are read and sent for review, with dropped rows noted', () => {
    const r = run('regression-r', { output: fx('reg-r.txt') }, { file: 'data/wages.csv', formula: 'wage ~ education + experience' });
    expect(r).toMatchObject({ status: 'needs_review', reasons: ['model_fitted', 'rows_dropped:3'] });
    expect(r.found).toEqual(expect.arrayContaining([['observations used', '117'], ['R-squared', '0.7434'], ['R', '4.3.3 (2024-02-29)']]));
    const p = run('regression-python', { output: fx('reg-py.txt') }, { file: 'data/wages.csv', formula: 'wage ~ education + experience' });
    expect(p).toMatchObject({ status: 'needs_review', reasons: ['model_fitted', 'rows_dropped:3'] });
    expect(p.found).toEqual(expect.arrayContaining([['R-squared', '0.743'], ['statsmodels', '0.15.0']]));
    expect(run('regression-r', { output: fx('reg-r-bad.txt') }, { file: 'data/wages.csv', formula: 'wage ~ education + tenure' })).toMatchObject({ status: 'failed', reasons: ['err_r_object:tenure'] });
  });
  it('a simulation is verified only when two runs with the same seed agree', () => {
    expect(run('simulation', { output: fx('sim1.txt'), output2: fx('sim2.txt') }, { script: 'simulate.py' })).toMatchObject({ status: 'verified', reasons: ['reproducible'] });
    expect(run('simulation', { output: fx('sim1.txt'), output2: fx('sim-bad.txt') }, { script: 'simulate.py' }).reasons).toEqual(['not_reproducible:final_position, max_position']);
    expect(run('simulation', { output: fx('sim1.txt') }, { script: 'simulate.py' }).reasons).toEqual(['no_second_run']);
  });
  it('qualitative coding stays reported by the student, and is incomplete without the counts and confirmations', () => {
    const counts = { documents: '12', codes: '18', highlights: '240' };
    expect(run('qualitative-coding', { counts, files: 'codebook.csv, highlights.xlsx', confirmed: ['anonymised', 'defined'] })).toMatchObject({ status: 'reported', reasons: ['coding_documented'] });
    expect(run('qualitative-coding', { counts, files: 'codebook.csv', confirmed: ['defined'] }).reasons).toEqual(['not_confirmed:anonymised']);
    expect(run('qualitative-coding', { counts: { documents: '12' }, confirmed: [] }).status).toBe('incomplete');
  });
  it('the package list must include every package named', () => {
    expect(run('environment-snapshot', { output: fx('freeze.txt') }, { packages: 'numpy, pandas, statsmodels' }).status).toBe('verified');
    expect(run('environment-snapshot', { output: fx('freeze.txt') }, { packages: 'numpy, torch' }).reasons).toEqual(['packages_missing:torch']);
  });
});

describe('errors, long logs, privacy and storage', () => {
  it('recognises common install and run errors', () => {
    expect(detectErrors("ModuleNotFoundError: No module named 'torch'")).toEqual(['err_module:torch']);
    expect(detectErrors('A module that was compiled using NumPy 1.x cannot be run in\nNumPy 2.1.3 as it may crash.')).toEqual(['err_numpy_abi']);
    expect(detectErrors('ERROR: No matching distribution found for torch==1.4.0')).toEqual(['err_version']);
    expect(detectErrors('Error in lmer(y ~ x) : could not find function "lmer"')).toEqual(['err_r_function:lmer']);
    expect(detectErrors('PermissionError: [Errno 13] Permission denied')).toEqual(['err_permission']);
  });
  it('a long log is checked in full, then only its start and end are kept', () => {
    const long = `${'epoch done\n'.repeat(15_000)}${fx('train.txt')}`;
    const r = submitEvidence(task('experiment', { script: 'train.py', metrics: 'rmse, mae' }), ev({ output: long, config: 'seed 7' }), { os: 'linux' });
    expect(r.ok).toBe(true);
    const t = (r as { task: ExecTask }).task;
    expect(t.review).toMatchObject({ status: 'needs_review', trimmed: true, chars: long.length });
    expect(t.evidence.output.length).toBeLessThan(6000);
    expect(t.evidence.output).toContain('METRIC mae=');
    expect(trimLog('short').trimmed).toBe(false);
    expect(submitEvidence(task('experiment'), ev({ output: 'x'.repeat(MAX_PASTE + 1) }), { os: 'linux' })).toEqual({ ok: false, problem: 'too_long' });
  });
  it('a secret stops the submission; names in paths are hidden in what is kept', () => {
    expect(submitEvidence(task('dataset-check', { file: 'data/solar.csv' }), ev({ output: 'api_key=sk-abcdefghijklmnopqrstuvwx' }), { os: 'linux' })).toEqual({ ok: false, problem: 'secret' });
    const r = submitEvidence(task('dataset-check', { file: 'data/missing.csv' }), ev({ output: 'FileNotFoundError: C:\\Users\\Amina\\proj\\data\\missing.csv' }), { os: 'windows' });
    expect((r as { task: ExecTask }).task.evidence.output).not.toContain('Amina');
  });
  it('stored tasks are cleaned: damaged ones dropped, unknown fields removed, limits kept', () => {
    const good = task('dataset-check', { file: 'data/solar.csv', extra: 'x' });
    const s = cleanExecution({ tasks: [good, good, { id: 'bad' }, { ...good, id: 'task-other-0002', template: 'unknown' }, { ...good, id: 'task-stage-0003', stage: 99 }] });
    expect(s.tasks.map((t) => t.id)).toEqual(['task-synthetic-0001', 'task-stage-0003']);
    expect(s.tasks[0].inputs).toEqual({ file: 'data/solar.csv' });
    expect(s.tasks[1].stage).toBe(0);
    expect(cleanExecution(undefined)).toEqual({ tasks: [] });
    expect(cleanExecution({ tasks: Array.from({ length: 40 }, (_, i) => ({ ...good, id: `task-many-${1000 + i}` })) }).tasks).toHaveLength(MAX_TASKS);
    // A review cannot be forged with an unknown status.
    expect(cleanExecution({ tasks: [{ ...good, review: { status: 'success', reasons: [], found: [], metrics: [], at: '', rule: 1 } }] }).tasks[0].review).toBeUndefined();
  });
  it('numbers typed by the student', () => {
    expect(typedMetrics('rmse = 0.12, MAE: 0,08\nskill 45 %')).toEqual([{ name: 'rmse', value: 0.12, raw: '0.12' }, { name: 'MAE', value: 0.08, raw: '0.08' }, { name: 'skill', value: 45, raw: '45' }]);
    expect(sameValue('0.12', 0.1234)).toBe(true);
    expect(sameValue('0.13', 0.1234)).toBe(false);
    expect(metricLines('METRIC rmse=nan\nMETRIC mae=1e-3')).toEqual([{ name: 'mae', value: 0.001 }]);
  });
});
