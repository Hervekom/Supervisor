import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, seed, started, stored, test } from './fixtures';

// Phase P7: research documents. Synthetic files from e2e/source-docs (see make.py). The guard blocks all external requests.
const DIR = path.join(process.cwd(), 'e2e/source-docs');
const f = (n: string) => path.join(DIR, n);
const docs = (page: Page) => page.getByTestId('source-doc');
const doc = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

async function importFiles(page: Page, names: string[]) {
  await page.goto('/sources');
  await page.getByLabel(/I may use these documents for my research/).check();
  await page.getByLabel('PDF or Word files').setInputFiles(names.map(f));
  for (const n of names) await expect(page.getByLabel('Import progress').getByText(n)).toBeVisible();
  await expect(page.getByLabel('Import progress')).not.toContainText(/Reading the file|Finding sections|Saving in this browser/, { timeout: 30_000 });
}

test('import needs the permission confirmation, reads PDF and Word in English and Chinese, and explains failures', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (r) => { if (r.method() !== 'GET') posts.push(r.url()); });
  await seed(page, { 'path:v1': started({ parts: { introduction: 'My own text.' } }) });
  await page.goto('/sources');
  await expect(page.getByLabel('PDF or Word files')).toBeDisabled();
  const before = await stored(page, 'path:v1');
  await importFiles(page, ['paper-en.pdf', 'thesis-zh.pdf', 'thesis-en-zh.docx', 'scanned.pdf', 'protected.pdf', 'broken.pdf']);
  const progress = page.getByLabel('Import progress');
  await expect(progress).toContainText('paper-en.pdf: Ready');
  await expect(progress).toContainText('thesis-zh.pdf: Ready');
  await expect(progress).toContainText('thesis-en-zh.docx: Ready');
  await expect(progress).toContainText('scanned.pdf: Kept, but no text could be read. No text could be read: this looks like a scanned document');
  await expect(progress).toContainText('protected.pdf: Not imported. This PDF is protected by a password.');
  await expect(progress).toContainText('broken.pdf: Not imported. This file could not be read.');
  // Nothing is discarded silently: failed files are listed with their reason.
  await expect(docs(page)).toHaveCount(6);
  const en = doc(page, 'paper-en.pdf');
  await expect(en).toContainText('Lantern Networks for Fictional Flood Forecasting');
  await expect(en).toContainText('Authors: Alice Fiction; Bob Example (file properties)');
  await expect(en).toContainText('Year: 2023 (page 1)');
  await expect(doc(page, 'thesis-zh.pdf')).toContainText('灯笼网络在虚构洪水预测中的应用研究');
  await expect(doc(page, 'thesis-zh.pdf')).toContainText('Type: Thesis or dissertation');
  await expect(doc(page, 'scanned.pdf')).toContainText('Year: not found in the document');
  await expect(doc(page, 'protected.pdf')).toContainText('Could not be read');
  // Files were read in the browser: nothing was sent, and the thesis was not changed.
  expect(posts).toEqual([]);
  expect(await stored(page, 'path:v1')).toEqual(before);
  // The same file again is not imported twice.
  await page.getByLabel('PDF or Word files').setInputFiles(f('paper-en.pdf'));
  await expect(progress).toContainText('This file is already in your documents');
  await expect(docs(page)).toHaveCount(6);
});

test('browse with page references, search, correct details, remove; all kept after reload', async ({ page }) => {
  await importFiles(page, ['paper-en.pdf', 'thesis-en-zh.docx', 'long.pdf']);
  const en = doc(page, 'paper-en.pdf');
  await en.getByRole('button', { name: 'Browse' }).click();
  await expect(en).toContainText('3.1 Data (page 2)');
  await en.getByText('Research questions (1)').click();
  await expect(en).toContainText('Research question RQ1: does a lantern network reduce forecast error compared with a persistence baseline?” (page 1, 1 Introduction)');
  await page.getByLabel('Search words').fill('RiverLight dataset samples');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByLabel('Search results')).toContainText('Lantern Networks for Fictional Flood Forecasting · page 2 · 3.1 Data');
  await page.getByLabel('Search words').fill('quantum lantern calibration');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByLabel('Search results').locator('li').first()).toContainText('page 46');
  await page.getByLabel('Search words').fill('protein folding molecular dynamics');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('No passage matches these words closely enough.')).toBeVisible();
  // Correct a detail.
  const word = doc(page, 'thesis-en-zh.docx');
  await word.getByRole('button', { name: 'Correct details' }).click();
  await page.getByLabel('Authors', { exact: true }).fill('Fiction, Carol');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(word).toContainText('Authors: Fiction, Carol (corrected by you)');
  // Remove, with confirmation.
  await doc(page, 'long.pdf').getByRole('button', { name: 'Remove long.pdf' }).click();
  await doc(page, 'long.pdf').getByRole('button', { name: 'Remove for good' }).click();
  await page.reload();
  await expect(docs(page)).toHaveCount(2);
  await expect(doc(page, 'thesis-en-zh.docx')).toContainText('Authors: Fiction, Carol (corrected by you)');
});

test('a document goes into the reference library, and copied text is flagged with its source page', async ({ page }) => {
  const copied = 'The RiverLight dataset contains 12,000 fictional samples collected from 40 invented rivers. Data were collected every hour.';
  await seed(page, { 'path:v1': started({ parts: { methodology: `${copied}\nMy own design uses two real gauges I installed myself last spring.` } }) });
  await importFiles(page, ['paper-en.pdf']);
  await doc(page, 'paper-en.pdf').getByRole('button', { name: 'Add to my reference library' }).click();
  await expect(page.getByText(/Added to your reference library as \[@fiction2023\]/)).toBeVisible();
  const p = await stored(page, 'path:v1');
  expect(p.library.refs[0]).toMatchObject({ key: 'fiction2023', title: 'Lantern Networks for Fictional Flood Forecasting', year: '2023', source: 'manual' });
  expect(p.parts.methodology).toContain(copied);
  await page.getByLabel('Part of my document').selectOption({ label: 'Methodology' });
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  const r = page.getByLabel('Passages too close to a source');
  await expect(r.locator('li')).toHaveCount(1);
  await expect(r).toContainText('Very close to its source');
  await expect(r).toContainText('Source: Lantern Networks for Fictional Flood Forecasting, page 2, 3.1 Data');
});

test('a thesis step shows relevant passages with their source and reason, and AI advice keeps attribution', async ({ page }) => {
  await seed(page, { 'path:v1': started({ topic: 'Lantern networks for flood forecasting', title: 'Flood forecasting with lantern networks', current: 'method' }) });
  await importFiles(page, ['paper-en.pdf', 'thesis-en-zh.docx']);
  await page.goto('/');
  const box = page.getByLabel('From your sources');
  await expect(box.getByTestId('source-hit').first()).toContainText('Lantern Networks for Fictional Flood Forecasting, page 2');
  await expect(box).toContainText('It may apply because it shares'); // P8 wording: Supervisor’s reading, apart from the evidence
  await expect(box).toContainText('It is someone else’s work: cite it if you use it.');
  await expect(box).not.toContainText('Fictional Lantern Thesis'); // the unrelated Word thesis is not offered
  await expect(box).toContainText(/Asking Supervisor sends these \d passages? \(\d+ characters\), your topic and this step’s goal to your AI service/);
  let sent = '';
  page.on('request', (r) => { if (r.url().includes('/api/sources/advise')) sent = r.postData() ?? ''; });
  await box.getByRole('button', { name: 'Ask Supervisor how these apply' }).click();
  const advice = page.getByLabel('Advice on your sources');
  await expect(advice).toContainText('Mock: this passage describes how the authors chose their data.');
  await expect(advice).toContainText('Cite: Mock: cite the dataset choice with its page.');
  await expect(advice).not.toContainText('Mock invented excerpt'); // an excerpt that was never sent
  await expect(advice).toContainText('Mock caution');
  // Only the chosen passages were sent, not whole documents.
  const body = JSON.parse(sent);
  expect(body.excerpts.length).toBeLessThanOrEqual(3);
  expect(body.excerpts.every((e: { text: string }) => e.text.length <= 1200)).toBe(true);
  expect(sent).not.toContain('References');
  const log = (await stored(page, 'path:v1')).log;
  expect(log.at(-1).tool).toMatch(/^Sources: advice on \d passages?/);
});

test('copied advice is removed before it is shown', async ({ page }) => {
  await seed(page, { 'path:v1': started({ topic: 'Lantern networks flood forecasting RiverLight', current: 'method' }) });
  await importFiles(page, ['paper-en.pdf']);
  await page.goto('/');
  const box = page.getByLabel('From your sources');
  await expect(box.getByTestId('source-hit')).toHaveCount(3);
  await box.getByRole('button', { name: 'Ask Supervisor how these apply' }).click();
  const advice = page.getByLabel('Advice on your sources');
  await expect(advice.locator('.item')).toHaveCount(1); // the point that copied its passage was dropped
});

test('an unrelated research topic gets no suggestion rather than a wrong one', async ({ page }) => {
  await seed(page, { 'path:v1': started({ topic: 'Protein folding with molecular dynamics', current: 'method' }) });
  await importFiles(page, ['paper-en.pdf']);
  await page.goto('/');
  await expect(page.getByLabel('From your sources')).toContainText('Supervisor shows nothing rather than an unrelated source');
});

test.describe('on a 390px screen', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('the sources page fits without side scrolling', async ({ page }) => {
    await importFiles(page, ['paper-en.pdf', 'thesis-zh.pdf']);
    await doc(page, 'paper-en.pdf').getByRole('button', { name: 'Browse' }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
