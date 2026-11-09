import { expect, test } from './fixtures';

test('the app loads with its navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Where are you with your thesis?' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const name of ['My thesis', 'Document', 'Lab', 'Check', 'Feedback', 'Account']) await expect(nav.getByRole('link', { name })).toBeVisible();
});

test('each main page opens', async ({ page }) => {
  for (const [url, heading] of [['/check', 'Check my thesis'], ['/account', 'Sign in']]) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
  for (const url of ['/document', '/lab', '/feedback', '/guides', '/journey']) {
    const res = await page.goto(url);
    expect(res?.status()).toBeLessThan(400);
  }
});
