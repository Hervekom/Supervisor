import { expect, seed, started, test } from './fixtures';

test.use({ viewport: { width: 390, height: 844 } });

const noSideScroll = (page: import('@playwright/test').Page) =>
  expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

for (const url of ['/', '/document', '/lab', '/check', '/feedback', '/account', '/guides', '/journey']) {
  test(`no side scrolling at 390px on ${url}`, async ({ page }) => {
    await page.goto(url);
    await noSideScroll(page);
  });
}

test('no side scrolling at 390px inside a step', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  await noSideScroll(page);
  await page.getByRole('tab', { name: '2. Write' }).click();
  await noSideScroll(page);
  await page.getByRole('tab', { name: '3. Critique' }).click();
  await noSideScroll(page);
});
