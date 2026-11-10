import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, seed, started, stored, test } from './fixtures';

// Phase P9: execution tasks. Every pasted output is the real output of the provided scripts on synthetic data.
const fx = (n: string) => readFileSync(`e2e/exec-fixtures/${n}`, 'utf8');
const check = (status: string) => ({ status, os: 'linux', rule: 1, at: '2026-11-09T09:00:00.000Z', reason: 'ok', found: 'x' });
const solarLab = { workTypes: ['deep_learning', 'data_science'], os: 'linux', gpu: 'yes', osConfirmed: true, updatedAt: '2026-11-09T09:00:00.000Z', tools: { python: { check: check('verified') }, venv: { check: check('verified') }, pandas: { marked: true } } };
const thesis = (lab: unknown, over = {}) => started({ current: 'experiments', lab: lab as never, ...over });
const tasks = async (page: Page) => ((await stored(page, 'path:v1'))?.execution?.tasks ?? []) as { template: string; stage: number; inputs: Record<string, string>; review?: { status: string; reasons: string[] }; evidence: { output: string } }[];
const box = (page: Page) => page.getByTestId('exec-task');
const cont = (page: Page) => box(page).getByRole('button', { name: 'Continue' });
const stageHeading = (page: Page, name: string) => box(page).getByRole('heading', { name, exact: true });

async function startTask(page: Page, title: string) {
  await page.locator('#tasks').getByRole('listitem').filter({ hasText: title }).getByRole('button', { name: 'Start this task' }).click();
  await expect(box(page).getByRole('heading', { name: title })).toBeVisible();
}

test('without a started thesis or a method, the tasks explain what to do first', async ({ page }) => {
  await page.goto('/lab');
  await expect(page.getByRole('heading', { name: 'Research tasks on your computer' })).toBeVisible();
  await expect(page.getByText('Once your thesis is started, the tasks you work on are saved with it.')).toBeVisible();
  await seed(page, { 'path:v1': thesis({ workTypes: [], os: 'linux', gpu: 'not_sure', osConfirmed: true, tools: {}, updatedAt: '' }) });
  await page.goto('/lab');
  await expect(page.getByText('Choose what your research involves above, and the tasks for your method appear here.')).toBeVisible();
});

test('solar forecasting: the dataset task goes stage by stage, rejects unsafe inputs, and is verified from real output', async ({ page }) => {
  await seed(page, { 'path:v1': thesis(solarLab, { steps: { title: { work: 'Synthetic title work.', checks: [0], status: 'open' } } }) });
  await page.goto('/lab');
  const list = page.locator('#tasks');
  for (const t of ['Check your dataset before using it', 'Run one experiment and document it', 'Check that PyTorch can use your NVIDIA GPU', 'Run one GPU training and document it', 'Record the exact versions of your environment']) await expect(list.getByText(t, { exact: true })).toBeVisible();
  await expect(list.getByText('Fit your regression model in R')).toHaveCount(0);
  await expect(list.getByText('Code your interviews and record the codebook')).toHaveCount(0);

  await startTask(page, 'Check your dataset before using it');
  // Only the current stage is shown.
  await expect(stageHeading(page, 'Understand the task')).toBeVisible();
  await expect(box(page).getByText('python check_dataset.py')).toHaveCount(0);
  await cont(page).click();
  await expect(stageHeading(page, 'What you need')).toBeVisible();
  await expect(box(page).getByText('Verification failed')).toHaveCount(0);
  await cont(page).click();
  await expect(box(page).getByText('source .venv/bin/activate')).toBeVisible(); // Linux, as chosen
  await cont(page).click();
  await expect(box(page).getByText(/1 of the tools this task needs is not verified yet/)).toBeVisible(); // pandas only marked
  await cont(page).click();
  await box(page).getByLabel('Data file, inside your project folder').fill('data/solar.csv; rm -rf ~');
  await expect(box(page).getByText('Use only letters, numbers and the characters shown in the hint.')).toBeVisible();
  await expect(cont(page)).toBeDisabled();
  await box(page).getByLabel('Data file, inside your project folder').fill('data/solar.csv');
  await box(page).getByLabel('Number of rows you expect (optional)').fill('240');
  await box(page).getByLabel('Date or time column (optional)').fill('timestamp');
  await cont(page).click();
  await expect(box(page).getByText('python check_dataset.py data/solar.csv timestamp')).toBeVisible();
  await expect(box(page).getByText('print("CHECK=done")')).toBeVisible();
  await cont(page).click();

  // A button press alone checks nothing.
  await box(page).getByRole('button', { name: 'Check my evidence' }).click();
  await expect(page.getByTestId('exec-review')).toContainText('Incomplete evidence');
  await expect(page.getByTestId('exec-review')).toContainText('Nothing was pasted.');
  await box(page).getByRole('button', { name: 'Return new evidence' }).click();
  await box(page).getByLabel('Paste everything the command printed').fill(fx('dataset-ok.txt'));
  await box(page).getByRole('button', { name: 'Check my evidence' }).click();
  await expect(page.getByTestId('exec-review')).toContainText('Verified');
  await expect(page.getByTestId('exec-review')).toContainText('The file opened, and its rows and columns match what you expect.');
  await expect(box(page).getByText('2025-01-01 00:00:00')).toBeVisible();
  const [t] = await tasks(page);
  expect(t).toMatchObject({ template: 'dataset-check', stage: 7, inputs: { file: 'data/solar.csv', rows: '240', date: 'timestamp' }, review: { status: 'verified' } });
  expect((await stored(page, 'path:v1')).steps.title.work).toBe('Synthetic title work.');

  // It survives a reload, and the next step is offered.
  await page.reload();
  await expect(page.getByTestId('task-status-dataset-check')).toHaveText('Verified. Stage 8 of 9.');
  await page.getByRole('button', { name: 'Open the task Check your dataset before using it' }).click();
  await cont(page).click();
  await expect(stageHeading(page, 'Next step')).toBeVisible();
  await expect(box(page).getByRole('button', { name: /^Next task:/ })).toBeVisible();
});

test('a messy dataset, a missing file and a secret are each handled', async ({ page }) => {
  await seed(page, { 'path:v1': thesis(solarLab) });
  await page.goto('/lab');
  await startTask(page, 'Check your dataset before using it');
  for (let i = 0; i < 4; i++) await cont(page).click();
  await box(page).getByLabel('Data file, inside your project folder').fill('data/solar_messy.csv');
  await box(page).getByLabel('Date or time column (optional)').fill('timestamp');
  await cont(page).click();
  await cont(page).click();
  await box(page).getByLabel('Paste everything the command printed').fill(fx('dataset-messy.txt'));
  await box(page).getByRole('button', { name: 'Check my evidence' }).click();
  const r = page.getByTestId('exec-review');
  await expect(r).toContainText('Needs scientific review');
  await expect(r).toContainText('The file has missing values.');
  await expect(r).toContainText('duplicate rows');

  await box(page).getByRole('button', { name: 'Return new evidence' }).click();
  await box(page).getByLabel('Paste everything the command printed').fill(fx('dataset-nofile.txt'));
  await box(page).getByRole('button', { name: 'Check my evidence' }).click();
  await expect(r).toContainText('Failed');
  await expect(r).toContainText('A file was not found.');
  expect((await tasks(page))[0].evidence.output).not.toContain('scratchpad');

  await box(page).getByRole('button', { name: 'Return new evidence' }).click();
  await box(page).getByLabel('Paste everything the command printed').fill(`${fx('dataset-ok.txt')}\ntoken=ghp_abcdefghijklmnopqrstuvwxyz123456`);
  await expect(box(page).getByText(/looks like it contains a password, key or token/).first()).toBeVisible();
  await box(page).getByRole('button', { name: 'Check my evidence' }).click();
  await expect(box(page).getByRole('alert').filter({ hasText: 'nothing was checked' }).last()).toBeVisible();
  expect((await tasks(page))[0].review?.status).toBe('failed'); // the previous review stays
});

test('an experiment is never marked a success; inconsistent numbers are caught; a large log is kept short; the run is saved', async ({ page }) => {
  await seed(page, { 'path:v1': thesis(solarLab) });
  await page.goto('/lab');
  await startTask(page, 'Run one experiment and document it');
  for (let i = 0; i < 4; i++) await cont(page).click();
  await box(page).getByLabel('Your script or notebook').fill('train.py');
  await box(page).getByLabel('Metrics the run must report').fill('rmse, mae');
  await cont(page).click();
  await expect(box(page).getByText('print("METRIC " + name + "=" + str(value))')).toBeVisible();
  await cont(page).click();
  const big = `${'epoch done, loss decreasing\n'.repeat(2500)}${fx('train.txt')}`;
  await box(page).getByLabel('Paste everything the command printed').fill(big);
  await box(page).getByLabel('The metrics you will report (optional)').fill('rmse = 120.0');
  await box(page).getByLabel('Configuration used').fill('seed: 7\nsplit: 80/20 by time\nmodel: linear baseline');
  await box(page).getByRole('button', { name: 'Check my evidence' }).click();
  const r = page.getByTestId('exec-review');
  await expect(r).toContainText('Incomplete evidence');
  await expect(r).toContainText('The value you typed for rmse differs from the one the run printed.');

  await box(page).getByRole('button', { name: 'Return new evidence' }).click();
  await box(page).getByLabel('Paste everything the command printed').fill(big);
  await box(page).getByLabel('The metrics you will report (optional)').fill('rmse = 314.36, mae = 284.85');
  await box(page).getByRole('button', { name: 'Check my evidence' }).click();
  await expect(r).toContainText('Needs scientific review');
  await expect(box(page).getByText(/All of it was checked; only its start and end are kept/)).toBeVisible();
  await expect(box(page).getByText('314.35841662794485')).toBeVisible();
  const stored1 = await tasks(page);
  expect(stored1[0].evidence.output.length).toBeLessThan(6000);

  await cont(page).click();
  await box(page).getByRole('button', { name: 'Save as an experiment run' }).click();
  await expect(box(page).getByText('Saved with your experiment runs below.')).toBeVisible();
  const runs = (await stored(page, 'path:v1')).runs;
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ source: 'student', seeds: '7', hardware: 'cpu', metrics: [{ name: 'rmse', value: 314.35841662794485 }, { name: 'mae', value: 284.8467640244237 }] });
  await box(page).getByRole('button', { name: 'Save as an experiment run' }).click();
  await expect(box(page).getByText('This run is already in your experiment runs.')).toBeVisible();
  expect((await stored(page, 'path:v1')).runs).toHaveLength(1);
});

test('GPU check: a CPU build of PyTorch fails with recovery steps; macOS gets no GPU task', async ({ page }) => {
  await seed(page, { 'path:v1': thesis(solarLab) });
  await page.goto('/lab');
  await startTask(page, 'Check that PyTorch can use your NVIDIA GPU');
  await expect(box(page).getByText('Needs an NVIDIA GPU').first()).toBeVisible();
  for (let i = 0; i < 5; i++) await cont(page).click();
  await expect(box(page).getByText('nvidia-smi', { exact: true })).toBeVisible();
  await cont(page).click();
  const smi = '| NVIDIA-SMI 566.14                 Driver Version: 566.14         CUDA Version: 12.7     |';
  await box(page).getByLabel('Paste everything the command printed').fill(`${smi}\ntorch 2.9.0+cpu cuda False\nGPU=none`);
  await box(page).getByRole('button', { name: 'Check my evidence' }).click();
  await expect(page.getByTestId('exec-review')).toContainText('This PyTorch was installed without GPU support (+cpu).');
  await box(page).getByRole('button', { name: 'Return new evidence' }).click();
  await box(page).getByLabel('Paste everything the command printed').fill(`${smi}\ntorch 2.9.0+cu128 cuda True\nGPU=NVIDIA GeForce RTX 4060`);
  await box(page).getByRole('button', { name: 'Check my evidence' }).click();
  await expect(page.getByTestId('exec-review')).toContainText('Verified');

  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('path:v1')!);
    p.lab.os = 'macos';
    localStorage.setItem('path:v1', JSON.stringify(p));
  });
  await page.reload();
  await expect(page.locator('#tasks').getByText('Run one GPU training and document it')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open the task Check that PyTorch can use your NVIDIA GPU' }).click();
  await box(page).getByRole('button', { name: /Prepare your computer/ }).click();
  await expect(box(page).getByText(/This task cannot run on macOS/)).toBeVisible();
  await expect(cont(page)).toBeDisabled();
});

test('statistics in R: R and RStudio only, R is checked in the console, and the regression goes to scientific review', async ({ page }) => {
  await seed(page, { 'path:v1': thesis({ workTypes: ['statistics_r'], os: 'windows', gpu: 'not_sure', osConfirmed: true, tools: {}, updatedAt: '2026-11-09T09:00:00.000Z' }) });
  await page.goto('/lab');
  await expect(page.getByRole('heading', { name: 'R', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'RStudio Desktop' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Python', exact: true })).toHaveCount(0);
  await expect(page.getByText('Open R or RStudio. In the Console, after the > sign, type this and press Enter:')).toBeVisible();
  // The check typed into a terminal by mistake is explained.
  const rCard = page.locator('li.lab-card').filter({ has: page.getByRole('heading', { name: 'R', exact: true }) });
  await rCard.getByLabel('Paste what the command printed').fill("'R.version.string' is not recognized as an internal or external command,");
  await rCard.getByRole('button', { name: 'Check output' }).click();
  await expect(page.getByText('This was typed in a terminal. R.version.string is typed in the R console.')).toBeVisible();
  await rCard.getByLabel('Paste what the command printed').fill(fx('rversion.txt'));
  await rCard.getByRole('button', { name: 'Check output' }).click();
  await expect(page.getByTestId('status-r')).toHaveText('Verified');
  await expect(page.getByText(/Supervisor has no automatic check for this tool/)).toBeVisible(); // RStudio

  await startTask(page, 'Fit your regression model in R');
  for (let i = 0; i < 4; i++) await cont(page).click();
  await box(page).getByLabel('Data file, inside your project folder').fill('data/wages.csv');
  await box(page).getByLabel('Model formula').fill('wage ~ education + experience');
  await cont(page).click();
  await expect(box(page).getByText('model <- lm(wage ~ education + experience, data = data)')).toBeVisible();
  await expect(box(page).getByText('source("regression.R")')).toBeVisible();
  await cont(page).click();
  await box(page).getByLabel('Paste everything the command printed').fill(fx('reg-r-bad.txt'));
  await box(page).getByRole('button', { name: 'Check my evidence' }).click();
  await expect(page.getByTestId('exec-review')).toContainText('R cannot find tenure.');
  await box(page).getByRole('button', { name: 'Return new evidence' }).click();
  await box(page).getByLabel('Paste everything the command printed').fill(fx('reg-r.txt'));
  await box(page).getByRole('button', { name: 'Check my evidence' }).click();
  await expect(page.getByTestId('exec-review')).toContainText('Needs scientific review');
  await expect(page.getByTestId('exec-review')).toContainText('3 rows of the file were not used');
});

test('qualitative research: Taguette only, coding stays reported by the student, and is incomplete until confirmed', async ({ page }) => {
  await seed(page, { 'path:v1': thesis({ workTypes: ['qualitative'], os: 'macos', gpu: 'not_sure', osConfirmed: true, tools: {}, updatedAt: '2026-11-09T09:00:00.000Z' }) });
  await page.goto('/lab');
  await expect(page.getByRole('heading', { name: 'Taguette' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Git' })).toHaveCount(0);
  await startTask(page, 'Code your interviews and record the codebook');
  await expect(box(page).getByText('A phone is enough').first()).toBeVisible();
  for (let i = 0; i < 6; i++) await cont(page).click();
  await box(page).getByLabel('Documents coded').fill('12');
  await box(page).getByLabel('Codes in the codebook').fill('18');
  await box(page).getByLabel('Highlights (coded passages)').fill('240');
  await box(page).getByLabel('Output files: names and what they contain').fill('codebook.csv: codes and definitions');
  await box(page).getByLabel('Every code has a written definition.').check();
  await box(page).getByRole('button', { name: 'Check my evidence' }).click();
  await expect(page.getByTestId('exec-review')).toContainText('Not confirmed: anonymised.');
  await box(page).getByRole('button', { name: 'Return new evidence' }).click();
  await box(page).getByLabel('Every transcript was anonymised before import.').check();
  await box(page).getByRole('button', { name: 'Check my evidence' }).click();
  await expect(page.getByTestId('exec-review')).toContainText('Reported by you');
  expect((await tasks(page))[0].review?.status).toBe('reported');
});

test('French interface for the tasks', async ({ page }) => {
  await seed(page, { 'path:v1': thesis({ workTypes: ['simulation'], os: 'windows', gpu: 'not_sure', osConfirmed: true, tools: {}, updatedAt: '' }) });
  await page.addInitScript(() => localStorage.setItem('lang:v1', 'fr'));
  await page.goto('/lab');
  await expect(page.getByRole('heading', { name: 'Tâches de recherche sur votre ordinateur' })).toBeVisible();
  await page.locator('#tasks').getByRole('listitem').filter({ hasText: 'Lancer votre simulation deux fois avec la même graine' }).getByRole('button', { name: 'Commencer cette tâche' }).click();
  await box(page).getByRole('button', { name: 'Continuer' }).click();
  await box(page).getByRole('button', { name: 'Continuer' }).click();
  await expect(box(page).getByText('.venv\\Scripts\\activate')).toBeVisible(); // Windows
  await expect(box(page).getByText('Ouvrez l’Invite de commandes (pas PowerShell)', { exact: false })).toBeVisible();
});

test('My thesis lists the practical tasks of the current step and opens them in the Lab', async ({ page }) => {
  await seed(page, { 'path:v1': thesis(solarLab) });
  await page.goto('/');
  const box2 = page.getByTestId('step-tasks');
  await expect(box2.getByRole('heading', { name: 'Practical tasks for this step' })).toBeVisible();
  await box2.getByRole('link', { name: 'Run one experiment and document it' }).click();
  await expect(page).toHaveURL(/\/lab\?task=experiment#tasks/);
  await expect(box(page).getByRole('heading', { name: 'Run one experiment and document it' })).toBeVisible();
  expect((await tasks(page)).map((t) => t.template)).toEqual(['experiment']);
});

test('an older saved copy without tasks, and a damaged one, open normally', async ({ page }) => {
  await seed(page, { 'path:v1': thesis(solarLab, { execution: { tasks: [{ id: 'bad' }, 'x', { id: 'task-synthetic-0001', template: 'dataset-check', stage: 42, inputs: { file: 'data/solar.csv' }, evidence: {}, createdAt: '2026-11-09T09:00:00.000Z', updatedAt: '' }] } as never }) });
  await page.goto('/lab');
  await expect(page.getByTestId('task-status-dataset-check')).toHaveText('No evidence yet. Stage 1 of 9.');
  await page.goto('/');
  await expect(page.getByTestId('step-tasks')).toBeVisible();
});

test.describe('on a 390px phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('the task explains why a PC is needed, evidence can be returned, and nothing scrolls sideways', async ({ page }) => {
    await seed(page, { 'path:v1': thesis(solarLab) });
    await page.goto('/lab');
    await startTask(page, 'Check your dataset before using it');
    await expect(page.getByTestId('phone-note')).toContainText('Read the task here, run it on your computer');
    await expect(box(page).getByText(/Reading a full data file needs a computer/)).toBeVisible();
    for (let i = 0; i < 4; i++) await cont(page).click();
    await box(page).getByLabel('Data file, inside your project folder').fill('data/solar.csv');
    await cont(page).click();
    await expect(box(page).getByText('print("CHECK=done")')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await cont(page).click();
    await box(page).getByLabel('Paste everything the command printed').fill(fx('dataset-ok.txt'));
    await box(page).getByRole('button', { name: 'Check my evidence' }).click();
    await expect(page.getByTestId('exec-review')).toContainText('Verified');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
