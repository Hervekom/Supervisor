import type { Page } from '@playwright/test';
import { expect, seed, started, stored, test } from './fixtures';

// All data is synthetic.
const LAB = { workTypes: ['python'], os: 'windows', gpu: 'no', osConfirmed: true, updatedAt: '2026-11-09T09:00:00.000Z', tools: { python: { check: { status: 'verified', os: 'windows', rule: 1, at: '2026-11-09T09:00:00.000Z', reason: 'ok', found: 'Python 3.12.7' } } } };
const thesis = (over = {}) => started({ current: 'experiments', steps: { title: { work: 'Fictional title work', checks: [0], status: 'open' } }, lab: LAB as never, ...over });

async function addRun(page: Page, name: string, results: [string, string][], extra: (p: Page) => Promise<void> = async () => {}) {
  await page.getByRole('button', { name: 'Add a run' }).click();
  await page.getByLabel('Run name').fill(name);
  for (const [i, [metric, value]] of results.entries()) {
    await page.getByRole('button', { name: 'Add a result' }).click();
    await page.getByLabel(`Result ${i + 1} name`).fill(metric);
    await page.getByLabel(`Result ${i + 1} value`).fill(value);
  }
  await extra(page);
  await page.getByRole('button', { name: 'Save run' }).click();
}
const runCard = (page: Page, name: string) => page.getByTestId('run-card').filter({ has: page.getByRole('heading', { name, exact: true }) });

test('runs need a started thesis, so they are always saved with it', async ({ page }) => {
  await page.goto('/lab');
  await expect(page.getByRole('heading', { name: 'Experiment runs' })).toBeVisible();
  await expect(page.getByText('Once your thesis is started, you can record each run here')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a run' })).toHaveCount(0);
});

test('a run is recorded as reported by the student, with verified versions filled in, and the thesis untouched', async ({ page }) => {
  await seed(page, { 'path:v1': thesis() });
  await page.goto('/lab');
  await page.getByRole('button', { name: 'Add a run' }).click();
  await expect(page.getByLabel('Software versions')).toHaveValue('Python 3.12.7');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await addRun(page, 'Baseline, seed 1', [['accuracy', '0.912'], ['F1', '88%']], async (p) => {
    await p.getByLabel('Random seeds').fill('1');
    await p.getByLabel('Result 2 data split').selectOption('validation');
  });
  const card = runCard(page, 'Baseline, seed 1');
  await expect(card.getByText('Reported by you')).toBeVisible();
  await expect(card.getByRole('row', { name: 'accuracy Test 0.912' })).toBeVisible();
  await expect(card.getByRole('row', { name: 'F1 Validation 88' })).toBeVisible();
  const saved = await stored(page, 'path:v1');
  expect(saved.runs).toHaveLength(1);
  expect(saved.runs[0]).toMatchObject({ source: 'student', name: 'Baseline, seed 1', seeds: '1', versions: 'Python 3.12.7', metrics: [{ name: 'accuracy', value: 0.912, split: 'test' }, { name: 'F1', value: 88, split: 'validation' }] });
  expect(saved.steps.title.work).toBe('Fictional title work');
  expect(saved.lab.tools.python.check.found).toBe('Python 3.12.7');
  await page.reload();
  await expect(runCard(page, 'Baseline, seed 1')).toBeVisible();
});

test('incomplete runs and wrong numbers are refused with a clear reason', async ({ page }) => {
  await seed(page, { 'path:v1': thesis() });
  await page.goto('/lab');
  await page.getByRole('button', { name: 'Add a run' }).click();
  await page.getByRole('button', { name: 'Save run' }).click();
  await expect(page.locator('.run-form').getByRole('alert')).toContainText('Give the run a name');
  await expect(page.locator('.run-form').getByRole('alert')).toContainText('Add at least one result, or mark the run as failed.');
  await page.getByLabel('Run name').fill('Bad number');
  await page.getByRole('button', { name: 'Add a result' }).click();
  await page.getByLabel('Result 1 name').fill('accuracy');
  await page.getByLabel('Result 1 value').fill('about ninety');
  await page.getByRole('button', { name: 'Save run' }).click();
  await expect(page.locator('.run-form').getByRole('alert')).toContainText('"accuracy" needs a number');
  expect((await stored(page, 'path:v1')).runs).toBeUndefined();
});

test('a failed run is kept with its explanation', async ({ page }) => {
  await seed(page, { 'path:v1': thesis() });
  await page.goto('/lab');
  await addRun(page, 'Full model, seed 2', [], async (p) => {
    await p.getByLabel('It failed or stopped').check();
    await p.getByLabel('Notes').fill('Out of memory at epoch 3 with batch size 64.');
  });
  await expect(runCard(page, 'Full model, seed 2').getByText('Reported by you · Failed run')).toBeVisible();
});

test('names, keys and markup in the log are hidden or shown as plain text', async ({ page }) => {
  await seed(page, { 'path:v1': thesis() });
  const dialogs: string[] = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto('/lab');
  await addRun(page, 'Logged run', [['loss', '0.231']], async (p) => {
    await p.getByLabel('Log excerpt (optional)').fill('saved C:\\Users\\student\\proj\\model.pt\nOPENAI_API_KEY=sk-abcdefghijklmnop1234\n<img src=x onerror=alert(1)>');
    await expect(p.locator('.run-form').getByRole('alert')).toContainText('replaced with [secret]');
  });
  const card = runCard(page, 'Logged run');
  await card.getByText('Log excerpt').click();
  await expect(card.locator('pre')).toHaveText('saved C:\\Users\\[user]\\proj\\model.pt\nOPENAI_API_KEY=[secret]\n<img src=x onerror=alert(1)>');
  await expect(card.locator('pre img')).toHaveCount(0);
  expect(dialogs).toEqual([]);
  expect(JSON.stringify(await stored(page, 'path:v1'))).not.toMatch(/sk-abc|Users\\\\student/);
});

test('results can be read from a small CSV file in the browser, without uploading it', async ({ page }) => {
  await seed(page, { 'path:v1': thesis() });
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/lab');
  await page.waitForLoadState('networkidle');
  const before = requests.filter((u) => !u.includes('/_next/')).length;
  await page.getByRole('button', { name: 'Add a run' }).click();
  await page.getByLabel('Run name').fill('From file');
  await page.locator('input[type=file]').setInputFiles({ name: 'metrics.csv', mimeType: 'text/csv', buffer: Buffer.from('metric,value,split\nRMSE,12.4,test\nMAE,8.1,validation\n') });
  await expect(page.getByText('2 results read from metrics.csv. Check them below.')).toBeVisible();
  await expect(page.getByLabel('Result 1 name')).toHaveValue('RMSE');
  await expect(page.getByLabel('Result 2 data split')).toHaveValue('validation');
  await page.getByRole('button', { name: 'Save run' }).click();
  await expect(runCard(page, 'From file').getByRole('row', { name: 'MAE Validation 8.1' })).toBeVisible();
  expect(requests.filter((u) => !u.includes('/_next/')).length).toBe(before);
});

test('repeated runs show the mean and standard deviation of the reported values only', async ({ page }) => {
  await seed(page, { 'path:v1': thesis() });
  await page.goto('/lab');
  for (const [i, v] of ['0.90', '0.92', '0.94'].entries()) await addRun(page, `Final model, seed ${i + 1}`, [['accuracy', v]]);
  await expect(page.getByTestId('run-summary').getByRole('row', { name: 'accuracy Test 3 0.92 0.02 0.9 to 0.94' })).toBeVisible();
});

test('a run can be added to the results sheet, labelled as reported', async ({ page }) => {
  await seed(page, { 'path:v1': thesis() });
  await page.goto('/lab');
  await addRun(page, 'Baseline, seed 1', [['accuracy', '0.912']]);
  await runCard(page, 'Baseline, seed 1').getByRole('button', { name: 'Add to my results sheet' }).click();
  await expect(runCard(page, 'Baseline, seed 1').getByText(/Added to your results sheet on/)).toBeVisible();
  const work = (await stored(page, 'path:v1')).steps.evidence.work as string;
  // Since B2.3 the results sheet template comes first, then the labelled run block.
  expect(work.startsWith('Research questions:')).toBe(true);
  expect(work).toMatch(/\n\nRun: Baseline, seed 1 \(reported by the student, \d{4}-\d{2}-\d{2}\)/);
  expect(work).toContain('Results: accuracy (test) = 0.912');
});

test('AI feedback reads only the run, drops invented numbers and is recorded', async ({ page }) => {
  await seed(page, { 'path:v1': thesis() });
  await page.goto('/lab');
  await addRun(page, 'Baseline, seed 1', [['accuracy', '0.912']]);
  const card = runCard(page, 'Baseline, seed 1');
  await card.getByRole('button', { name: 'Ask for feedback' }).click();
  await expect(card.getByText('Mock run review. The reported value 0.912 comes from one seed.')).toBeVisible();
  await expect(card.getByText(/0\.987/)).toHaveCount(0);
  await expect(card.getByText(/15%/)).toHaveCount(0);
  await expect(card.getByText('2 statements were removed because they made a numerical or comparative claim that could not be checked against your run.', { exact: false })).toBeVisible();
  await expect(card.getByText('Next: Mock: run two more seeds.')).toBeVisible();
  const log = (await stored(page, 'path:v1')).log as { tool: string }[];
  expect(log.at(-1)!.tool).toBe('Run feedback: comments on the reported run "Baseline, seed 1"');
});

test('deleting a run asks first', async ({ page }) => {
  await seed(page, { 'path:v1': thesis() });
  await page.goto('/lab');
  await addRun(page, 'Throwaway', [['accuracy', '0.5']]);
  const card = runCard(page, 'Throwaway');
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  await card.getByRole('button', { name: 'Keep it' }).click();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  await card.getByRole('button', { name: 'Delete this run' }).click();
  await expect(runCard(page, 'Throwaway')).toHaveCount(0);
  expect((await stored(page, 'path:v1')).runs).toEqual([]);
});

test('editing a run keeps its identity and date', async ({ page }) => {
  await seed(page, { 'path:v1': thesis() });
  await page.goto('/lab');
  await addRun(page, 'Draft name', [['accuracy', '0.5']]);
  const before = (await stored(page, 'path:v1')).runs[0];
  await runCard(page, 'Draft name').getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Run name').fill('Better name');
  await page.getByRole('button', { name: 'Save run' }).click();
  const after = (await stored(page, 'path:v1')).runs[0];
  expect(after).toMatchObject({ id: before.id, createdAt: before.createdAt, name: 'Better name' });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('a run can be recorded and read without side scrolling', async ({ page }) => {
    await seed(page, { 'path:v1': thesis() });
    await page.goto('/lab');
    for (const [i, v] of ['0.90', '0.92'].entries()) await addRun(page, `Seed ${i + 1}`, [['accuracy', v], ['loss', '0.3']]);
    await expect(page.getByTestId('run-summary')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
