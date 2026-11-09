import type { Page } from '@playwright/test';
import { expect, seed, started, stored, test } from './fixtures';

// Phase B2.3 fixes. All data is synthetic.
const T = '2026-11-09T09:00:00.000Z';
const run = (id: string, name: string) => ({ id, source: 'student', step: 'experiments', outcome: 'completed', name, purpose: '', dataset: '', split: '', model: '', settings: '', seeds: '', versions: '', hardware: '', duration: '', metrics: [{ name: 'accuracy', value: 0.9, split: 'test' }], log: '', notes: '', createdAt: T, updatedAt: T });
const runCard = (page: Page, name: string) => page.getByTestId('run-card').filter({ has: page.getByRole('heading', { name, exact: true }) });

test('D2: switching language back and forth keeps an unfinished run form, and saves nothing', async ({ page }) => {
  await seed(page, { 'path:v1': started({ current: 'experiments' }) });
  await page.goto('/lab');
  const before = await stored(page, 'path:v1');
  await page.getByRole('button', { name: 'Add a run' }).click();
  await page.getByLabel('Research step').selectOption('research');
  await page.getByLabel('Run name').fill('Pilot, seed 7');
  await page.getByLabel('Why you ran it').fill('Check the pipeline');
  await page.getByLabel('Data', { exact: true }).fill('Synthetic set, 500 rows');
  await page.getByLabel('Main settings').fill('lr 0.01');
  await page.getByRole('button', { name: 'Add a result' }).click();
  await page.getByLabel('Result 1 name').fill('accuracy');
  await page.getByLabel('Result 1 value').fill('0.71');
  await page.getByLabel('Log excerpt (optional)').fill('epoch 3 loss 0.6');
  await page.getByLabel('Notes').fill('Unfinished notes');
  for (const lang of ['Français', 'English', 'Français', 'English']) await page.getByRole('button', { name: lang }).click();
  await page.getByRole('button', { name: 'Français' }).click();
  await expect(page.getByLabel('Nom de l’expérience')).toHaveValue('Pilot, seed 7');
  await expect(page.getByLabel('Pourquoi vous l’avez lancée')).toHaveValue('Check the pipeline');
  await expect(page.getByLabel('Données', { exact: true })).toHaveValue('Synthetic set, 500 rows');
  await expect(page.getByLabel('Réglages principaux')).toHaveValue('lr 0.01');
  await expect(page.getByLabel('Nom du résultat 1')).toHaveValue('accuracy');
  await expect(page.getByLabel('Valeur du résultat 1')).toHaveValue('0.71');
  await expect(page.getByLabel('Extrait du journal (facultatif)')).toHaveValue('epoch 3 loss 0.6');
  await expect(page.getByLabel('Notes')).toHaveValue('Unfinished notes');
  await expect(page.getByLabel('Étape de recherche')).toHaveValue('research');
  expect(await stored(page, 'path:v1')).toEqual(before);
  await page.getByRole('button', { name: 'Enregistrer l’expérience' }).click();
  await expect(runCard(page, 'Pilot, seed 7')).toBeVisible();
});

test('D10: a run added before the results sheet is opened keeps the template first, once', async ({ page }) => {
  await seed(page, { 'path:v1': started({ current: 'evidence', runs: [run('run-aaaaaa', 'Baseline')] as never }) });
  await page.goto('/lab');
  await runCard(page, 'Baseline').getByRole('button', { name: 'Add to my results sheet' }).click();
  let work = (await stored(page, 'path:v1')).steps.evidence.work as string;
  expect(work.startsWith('Research questions:')).toBe(true);
  expect(work).toContain('Run: Baseline (reported by the student, 2026-11-09)');
  await runCard(page, 'Baseline').getByRole('button', { name: 'Add to my results sheet again' }).click();
  await page.goto('/');
  await page.getByRole('tab', { name: '2. Write' }).click();
  work = await page.locator('#work').inputValue();
  expect(work.split('Research questions:').length).toBe(2);
  expect(work.split('Run: Baseline').length).toBe(3);
});

test('D10: notes made of runs only, from the earlier version, get the template when the sheet opens', async ({ page }) => {
  const block = 'Run: Baseline (reported by the student, 2026-11-09)\nResults: accuracy (test) = 0.9';
  await seed(page, { 'path:v1': started({ current: 'evidence', steps: { evidence: { work: block, checks: [], status: 'open' } } }) });
  await page.goto('/');
  await page.getByRole('tab', { name: '2. Write' }).click();
  await expect.poll(() => page.locator('#work').inputValue()).toMatch(/^Research questions:/);
  const work = await page.locator('#work').inputValue();
  expect(work.endsWith(block), JSON.stringify(work.slice(-120))).toBe(true);
  expect((await stored(page, 'path:v1')).steps.evidence.work).toBe(work);
});

test('D12: an edit is kept when the run was deleted in another tab', async ({ page, context }) => {
  await seed(page, { 'path:v1': started({ current: 'experiments', runs: [run('run-aaaaaa', 'Draft run')] as never }) });
  await page.goto('/lab');
  await runCard(page, 'Draft run').getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Notes').fill('Edited while it was deleted elsewhere');
  const other = await context.newPage();
  await other.goto('/lab');
  await runCard(other, 'Draft run').getByRole('button', { name: 'Delete', exact: true }).click();
  await runCard(other, 'Draft run').getByRole('button', { name: 'Delete this run' }).click();
  await expect(runCard(other, 'Draft run')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save run' }).click();
  await expect(page.getByText('This run was deleted in another window while you edited it.')).toBeVisible();
  const runs = (await stored(page, 'path:v1')).runs;
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ id: 'run-aaaaaa', notes: 'Edited while it was deleted elsewhere' });
});

test('accessibility: a skip link leads to the content, and the summary table says it scrolls on phones', async ({ page }) => {
  await seed(page, { 'path:v1': started({ current: 'experiments', runs: [run('run-aaaaaa', 'Seed 1'), { ...run('run-bbbbbb', 'Seed 2'), metrics: [{ name: 'accuracy', value: 0.92, split: 'test' }] }] as never }) });
  await page.goto('/lab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await expect(page.getByText('Swipe sideways to see every column.')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('Swipe sideways to see every column.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Repeated results' })).toBeVisible();
});
