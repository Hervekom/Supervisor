import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, seed, started, test } from './fixtures';

// Phase P8. Synthetic documents (e2e/source-docs); the AI is the local mock; the guard blocks external requests.
const f = (n: string) => path.join(process.cwd(), 'e2e/source-docs', n);
const doc = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

async function importFiles(page: Page, names: string[]) {
  await page.goto('/sources');
  await page.getByLabel(/I may use these documents for my research/).check();
  await page.getByLabel('PDF or Word files').setInputFiles(names.map(f));
  await expect(page.getByLabel('Import progress')).not.toContainText(/Reading the file|Finding sections|Saving in this browser/, { timeout: 30_000 });
}

test('search by meaning finds other words, and AI-suggested terms send only the search words', async ({ page }) => {
  await importFiles(page, ['paper-en.pdf']);
  await page.getByLabel('Search words').fill('corpus samples');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const results = page.getByLabel('Search results');
  await expect(results).toContainText('page 2 · 3.1 Data');
  await expect(results).toContainText('Related by meaning: dataset');
  await page.getByLabel(/Search by meaning/).uncheck();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('No passage matches these words closely enough.')).toBeVisible();
  await page.getByLabel(/Search by meaning/).check();
  let sent = '';
  page.on('request', (r) => { if (r.url().includes('/api/sources/expand')) sent = r.postData() ?? ''; });
  await page.getByRole('button', { name: 'Suggest related terms with AI' }).click();
  await expect(page.getByText('Also searching for: dataset, 数据集, corpus.')).toBeVisible();
  expect(JSON.parse(sent)).toEqual({ query: 'corpus samples' });
});

test('AI analysis: selected passages only, stated vs interpretation, not found, traced items, cached, out of date after a correction', async ({ page }) => {
  await importFiles(page, ['paper-en.pdf']);
  const d = doc(page, 'paper-en.pdf');
  await d.getByRole('button', { name: 'Browse' }).click();
  const panel = page.getByRole('region', { name: 'AI analysis of paper-en.pdf' });
  await expect(panel).toContainText(/Sends \d+ passages of this document \([\d,]+ characters\).*The rest of the document and the file itself are not sent/);
  let body = '';
  let calls = 0;
  page.on('request', (r) => { if (r.url().includes('/api/sources/analyse')) { calls++; body = r.postData() ?? ''; } });
  await panel.getByRole('button', { name: 'Analyse with AI' }).click();
  await expect(panel).toContainText('Datasets and data sources (2)');
  await expect(panel).toContainText('Stated in the document Mock: the dataset has 12,000 fictional samples.');
  await expect(panel).toContainText('“12,000 fictional samples”');
  await expect(panel).toContainText('page 2, 3.1 Data');
  await expect(panel).toContainText('AI interpretation Mock: the data seem collected hourly.');
  await expect(panel).not.toContainText('15,000');
  await expect(panel).toContainText('2 items were removed because they could not be traced to the passages');
  await expect(panel).toContainText('Theoretical framework: not found');
  await panel.getByText('Theoretical framework: not found').click();
  await expect(panel).toContainText(/Not found in the \d+ passages examined/);
  const sent = JSON.parse(body);
  expect(sent.passages.length).toBeLessThanOrEqual(14);
  expect(body).not.toContain('Alice Fiction and Bob Example');
  expect(body).not.toContain('Gradient lanterns[J]');
  // Kept in this browser: a reload shows it without asking again.
  await page.reload();
  await doc(page, 'paper-en.pdf').getByRole('button', { name: 'Browse' }).click();
  await expect(page.getByRole('region', { name: 'AI analysis of paper-en.pdf' })).toContainText('Datasets and data sources (2)');
  expect(calls).toBe(1);
  // A corrected detail marks it as out of date.
  await doc(page, 'paper-en.pdf').getByRole('button', { name: 'Correct details' }).click();
  await page.getByLabel('Year', { exact: true }).fill('2022');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByRole('region', { name: 'AI analysis of paper-en.pdf' })).toContainText('You corrected this document’s details after the analysis.');
});

test('AI analysis can be cancelled, and a failure is explained with Try again', async ({ page }) => {
  await importFiles(page, ['paper-en.pdf']);
  let calls = 0;
  await page.route('**/api/sources/analyse', async (r) => {
    calls++;
    if (calls === 1) {
      await new Promise((ok) => setTimeout(ok, 4000));
      return r.fulfill({ json: { aspects: {}, dropped: 0 } }).catch(() => {});
    }
    if (calls === 2) return r.fulfill({ status: 503, json: { error: 'The AI service is having problems right now. Your text is still here, nothing was lost.', code: 'provider_down', retryable: true } });
    return r.fallback();
  });
  await doc(page, 'paper-en.pdf').getByRole('button', { name: 'Browse' }).click();
  const panel = page.getByRole('region', { name: 'AI analysis of paper-en.pdf' });
  await panel.getByRole('button', { name: 'Analyse with AI' }).click();
  await expect(panel.getByRole('status')).toContainText('Analysing');
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel).toContainText('Cancelled. Nothing was changed.');
  await panel.getByRole('button', { name: 'Analyse with AI' }).click();
  await expect(panel.getByRole('alert')).toContainText('The AI service is having problems right now.');
  await panel.getByRole('button', { name: 'Try again' }).click();
  await expect(panel).toContainText('Datasets and data sources (2)');
});

test('comparing two documents shows each with pages, shared names, and conflicting values', async ({ page }) => {
  await importFiles(page, ['paper-en.pdf', 'paper-b.pdf']);
  const cmp = page.getByLabel('Compare documents');
  await cmp.getByLabel('Lantern Networks for Fictional Flood Forecasting').check();
  await cmp.getByLabel('Revisiting Glow Models for River Level Prediction').check();
  await cmp.getByRole('button', { name: 'Compare' }).click();
  await expect(cmp).toContainText('do not use it the same way');
  const conflicts = cmp.getByLabel('Different values reported');
  await expect(conflicts).toContainText('accuracy: Lantern Networks for Fictional Flood Forecasting: 0.91 (page 3');
  await expect(conflicts).toContainText('Revisiting Glow Models for River Level Prediction: 0.78 (page');
  await expect(conflicts).toContainText('RMSE');
  const data = cmp.getByRole('region', { name: 'Datasets' });
  await expect(data).toContainText('The same name appears in all of them: RiverLight');
  await expect(data).toContainText('GlowRiver');
  await expect(data).toContainText('(page 2, 3.1 Data)');
});

test('a thesis step separates evidence from interpretation, lists gaps and questions, and asks for a missing citation', async ({ page }) => {
  await seed(page, { 'path:v1': started({ topic: 'Lantern networks for flood forecasting', current: 'method', steps: { method: { work: 'Lantern networks reach an RMSE of 1.20 on sparse rivers. My design uses two gauges I will install myself.', checks: [], status: 'open' } } }) });
  await importFiles(page, ['paper-en.pdf']);
  await page.goto('/');
  const box = page.getByLabel('From your sources');
  await expect(box.getByTestId('source-hit').first()).toContainText('Evidence, from the document');
  await expect(box.getByTestId('source-hit').first()).toContainText('Supervisor’s reading');
  await expect(box).toContainText('Questions to investigate');
  await expect(box).toContainText(/Why would your method differ from the one in “Lantern Networks for Fictional Flood Forecasting” \(page \d\)/);
  const cite = box.getByLabel('Citations needed');
  await expect(cite).toContainText('Lantern networks reach an RMSE of 1.20 on sparse rivers.');
  await expect(cite).toContainText('it gives the value 1.20, which comes from this source');
  await expect(cite).not.toContainText('two gauges');
});

test.describe('on a 390px screen', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('analysis and comparison fit without side scrolling', async ({ page }) => {
    await importFiles(page, ['paper-en.pdf', 'paper-b.pdf']);
    await doc(page, 'paper-en.pdf').getByRole('button', { name: 'Browse' }).click();
    await page.getByRole('region', { name: 'AI analysis of paper-en.pdf' }).getByRole('button', { name: 'Analyse with AI' }).click();
    await expect(page.getByRole('region', { name: 'AI analysis of paper-en.pdf' })).toContainText('Datasets and data sources (2)');
    const cmp = page.getByLabel('Compare documents');
    await cmp.getByLabel('Lantern Networks for Fictional Flood Forecasting').check();
    await cmp.getByLabel('Revisiting Glow Models for River Level Prediction').check();
    await cmp.getByRole('button', { name: 'Compare' }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
