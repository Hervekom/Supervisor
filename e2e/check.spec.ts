import { buildSyntheticThesis } from '../tests/helpers/syntheticThesis';
import { expect, test } from './fixtures';

const file = async () => ({
  name: 'synthetic-thesis.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  buffer: Buffer.from(await buildSyntheticThesis()),
});

test('asks for a file first', async ({ page }) => {
  await page.goto('/check');
  await page.getByRole('button', { name: 'Check my thesis' }).click();
  await expect(page.locator('.error')).toHaveText('Choose your thesis file first.');
});

test('checks a synthetic thesis and shows its sources', async ({ page }) => {
  await page.goto('/check');
  await expect(page.locator('#uni option')).not.toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles(await file());
  await expect(page.getByText('synthetic-thesis.docx')).toBeVisible();
  await page.getByRole('button', { name: 'Check my thesis' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /to fix$/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ask your graduate school' })).toBeVisible();
  await expect(page.getByText('Would your argument survive a reviewer?')).toBeVisible();
  await expect(page.getByText('Show the rule').first()).toBeVisible();
});

test('the blind review copy finds a name', async ({ page }) => {
  await page.goto('/check');
  await expect(page.locator('#uni option')).not.toHaveCount(0);
  await page.getByRole('radio', { name: 'Blind review' }).check();
  await page.getByLabel('Names').fill('Candidate Example');
  await page.locator('input[type=file]').setInputFiles(await file());
  await page.getByRole('button', { name: 'Check my thesis' }).click();
  await expect(page.getByText('Filled-in identity fields remain on the cover.')).toBeVisible();
});
