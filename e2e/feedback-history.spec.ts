import type { Page } from '@playwright/test';
import { expect, seed, started, stored, test } from './fixtures';

// Phase P3: chapter feedback history. Synthetic text, mock AI.
const intro = 'Chapter 3 studies the fictional lantern method, a synthetic approach invented only for this test, and explains each design choice in plain words for the examiners.';
const end = 'Results follow in the next chapter, where every number is reported by the student and compared under the same conditions as the baselines.';
const v1 = `${intro}\nWe use dataset A.\n${end}`;
const v2 = `${intro}\nWe use dataset A and dataset B, because B is public.\n${end}`;

async function analyse(page: Page, text: string, chapter = 'Chapter 3 Method') {
  await expect(page.getByLabel('Degree')).toHaveValue(/.+/); // the degree list comes from the university profile
  await page.getByLabel('Chapter name').fill(chapter);
  await page.getByLabel('Chapter text').fill(text);
  await page.getByRole('button', { name: 'Get feedback' }).click();
}
const history = (page: Page) => page.locator('#history');
const saved = async (page: Page) => ((await stored(page, 'path:v1'))?.chapterFeedback ?? []) as { id: string; status: string; snapshot: { text: string }; analyzedAt: string; stepId: string; chapter: string }[];

test('a report is saved, survives a refresh and reopens with the chapter text it analysed', async ({ page }) => {
  await seed(page, { 'path:v1': started({ parts: { intro: 'My own introduction.' } }) });
  await page.goto('/feedback');
  await analyse(page, v1);
  await expect(page.getByText('Saved to your feedback history.')).toBeVisible();
  await expect(page.getByText('Latest report')).toBeVisible();
  const [r] = await saved(page);
  expect(r).toMatchObject({ status: 'current', stepId: 'draft', chapter: 'Chapter 3 Method', snapshot: { text: v1 } });
  expect(Date.parse(r.analyzedAt)).not.toBeNaN();
  expect((await stored(page, 'path:v1')).parts.intro).toBe('My own introduction.');

  await page.reload();
  await expect(history(page).getByText('1 report on 1 chapter.')).toBeVisible();
  await expect(page.getByText('Mock chapter feedback.')).toHaveCount(0);
  await history(page).getByRole('button', { name: /^Open the report/ }).click();
  await expect(page.getByText('Mock chapter feedback.')).toBeVisible();
  await page.getByText('The chapter text analysed').click();
  await expect(page.locator('#report').getByText('We use dataset A.')).toBeVisible();
});

test('a retried identical response is stored once; a second analysis is added and the first is kept', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  await page.goto('/feedback');
  await analyse(page, v1);
  await expect(page.getByText('Saved to your feedback history.')).toBeVisible();
  await page.getByRole('button', { name: 'Get feedback' }).click();
  await expect(page.getByText('This report is already in your history. It was not saved twice.')).toBeVisible();
  expect(await saved(page)).toHaveLength(1);

  await analyse(page, v2);
  await expect(page.getByText('Saved to your feedback history.')).toBeVisible();
  const list = await saved(page);
  expect(list.map((r) => r.status)).toEqual(['superseded', 'current']);
  expect(list[0].snapshot.text).toBe(v1);
  await expect(history(page).getByText('Latest', { exact: true })).toHaveCount(1);
  await expect(history(page).getByText('Earlier', { exact: true })).toHaveCount(1);

  // Comparing the two shows the chapter versions and the points raised.
  await page.getByRole('button', { name: 'Compare' }).click();
  const cmp = page.getByLabel('Comparison of two reports');
  await expect(cmp.getByRole('heading', { name: 'Earlier report', exact: true })).toBeVisible();
  await expect(cmp.getByText('2 paragraphs unchanged, 1 new or changed, 1 removed.', { exact: false })).toBeVisible();
  await cmp.getByText('New or changed paragraphs (1)').click();
  await expect(cmp.getByText('We use dataset A and dataset B, because B is public.')).toBeVisible();

  // The earlier report reopens, clearly marked as earlier.
  await history(page).getByRole('button', { name: /^Open the report/ }).last().click();
  await expect(page.locator('#report').getByText('Earlier report')).toBeVisible();

  // Deleting needs a second click, and the remaining report becomes the latest.
  await history(page).getByRole('button', { name: /^Delete the report/ }).first().click();
  await history(page).getByRole('button', { name: 'Delete this report for good' }).click();
  expect((await saved(page)).map((r) => r.status)).toEqual(['current']);
});

test('without a started thesis the student is told the feedback is not kept', async ({ page }) => {
  await page.goto('/feedback');
  await analyse(page, v1);
  await expect(page.getByText('Mock chapter feedback.')).toBeVisible();
  await expect(page.getByText(/not kept after you leave the page/)).toBeVisible();
  expect(await stored(page, 'path:v1')).toBeNull();
});

test('full browser storage is reported and nothing is lost', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  await page.goto('/feedback');
  await analyse(page, v1);
  await expect(page.getByText('Saved to your feedback history.')).toBeVisible();
  await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'path:v1') throw new DOMException('full', 'QuotaExceededError');
      return real.call(this, k, v);
    };
  });
  await analyse(page, v2);
  await expect(page.getByText(/storage is full, so the report could not be saved\. Nothing was removed/)).toBeVisible();
  expect(await saved(page)).toHaveLength(1);
});

test('an older saved copy without history works, and My document links to the latest report', async ({ page }) => {
  const report = {
    id: 'r-synthetic-1', stepId: 'draft', chapter: 'Chapter 2 Literature', analyzedAt: '2026-11-09T08:00:00.000Z', status: 'current', fingerprint: 'f1',
    snapshot: { version: 'abcdef0123456789', text: 'Synthetic literature chapter.', totalChars: 29, words: 3 },
    feedback: { summary: 'Synthetic saved feedback.', strengths: [], issues: [], next_steps: [] },
    settings: { degree: 'master_academic', discipline: '', language: 'English' },
  };
  await seed(page, { 'path:v1': started({ chapterFeedback: [report] as never }) });
  await page.goto('/document');
  const box = page.getByLabel('Chapter feedback history');
  await expect(box.getByText('Chapter 2 Literature')).toBeVisible();
  await box.getByRole('link', { name: 'Open the latest feedback on Chapter 2 Literature' }).click();
  await expect(page.getByText('Synthetic saved feedback.')).toBeVisible();
  await expect(page.locator('#report').getByText('Latest report')).toBeVisible();
});

test('an older saved copy without any history field opens Feedback normally', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  await page.goto('/feedback');
  await expect(page.getByRole('heading', { name: 'Feedback history' })).toHaveCount(0);
  await page.goto('/document');
  await expect(page.getByLabel('Chapter feedback history')).toHaveCount(0);
});

test.describe('on a 390px screen', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('history and comparison fit without side scrolling', async ({ page }) => {
    await seed(page, { 'path:v1': started() });
    await page.goto('/feedback');
    await analyse(page, v1);
    await expect(page.getByText('Saved to your feedback history.')).toBeVisible();
    await analyse(page, v2);
    await expect(history(page).getByText('2 reports on 1 chapter.')).toBeVisible();
    await page.getByRole('button', { name: 'Compare' }).click();
    await expect(page.getByLabel('Comparison of two reports')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
