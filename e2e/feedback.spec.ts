import { expect, test } from './fixtures';

test('chapter feedback uses the mock AI', async ({ page }) => {
  await page.goto('/feedback');
  await page.getByLabel('Chapter text').fill('A fictional chapter about lanterns. '.repeat(20));
  await page.getByRole('button', { name: /feedback/i }).last().click();
  await expect(page.getByText('Mock chapter feedback.')).toBeVisible();
});

test('reference check shows a mocked Crossref result', async ({ page }) => {
  await page.route('**/api/references', (r) =>
    r.fulfill({ json: { results: [{ entry: '[1] Fiction A. A lantern method[J]. 2024', status: 'verified', matchedTitle: 'A lantern method', doi: '10.0000/fiction', score: 0.99 }] } }),
  );
  await page.goto('/feedback');
  await page.getByRole('tab', { name: 'References' }).click();
  await page.getByLabel('References, one per line').fill('[1] Fiction A. A lantern method[J]. 2024');
  await page.getByRole('button', { name: /check|verify/i }).last().click();
  await expect(page.getByRole('heading', { name: 'Reference check' })).toBeVisible();
  await expect(page.getByText('10.0000/fiction', { exact: false })).toBeVisible();
});
