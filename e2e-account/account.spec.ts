import { expect, test, type Page } from '@playwright/test';

const S = 'http://127.0.0.1:4120';
const state = () => fetch(`${S}/__state`).then((r) => r.json());
const started = (work = '', over = {}) => ({ topic: 'Fictional', discipline: '', defenseDate: '', current: 'title', started: true, situation: 'title', steps: { title: { work, checks: [0, 1, 2, 3, 4], status: 'open' } }, log: [], savedAt: '2026-11-01T00:00:00.000Z', ...over });

// The Supabase client retries failed reads for several seconds before reporting an outage.
test.beforeEach(async () => { await fetch(`${S}/__reset`); });

async function seedLocal(page: Page, path: unknown) {
  await page.goto('/guides');
  await page.evaluate((p) => localStorage.setItem('path:v1', JSON.stringify(p)), path);
}
async function signIn(page: Page) {
  await page.goto('/account');
  await page.getByLabel('Email').fill('student@example.test');
  await page.getByLabel('Password', { exact: true }).fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Signed in as')).toBeVisible();
}
const openWrite = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('tab', { name: '2. Write' }).click();
};
const local = (page: Page) => page.evaluate(() => localStorage.getItem('path:v1'));

test('C3: guest work reaches the account right after sign-in', async ({ page }) => {
  await seedLocal(page, started('Guest work written before signing in'));
  await signIn(page);
  await expect(page.getByText('The work from this browser is saved to your account.')).toBeVisible();
  expect((await state()).row.data.steps.title.work).toBe('Guest work written before signing in');
});

test('C3: sign-out clears the browser only after the account holds the work', async ({ page }) => {
  await seedLocal(page, started('Guest work to keep'));
  await signIn(page);
  await expect(page.getByText('The work from this browser is saved to your account.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('Signed out. Your work is saved to your account.')).toBeVisible();
  expect(await local(page)).toBeNull();
  expect((await state()).row.data.steps.title.work).toBe('Guest work to keep');
});

test('C3: when saving fails, sign-out keeps the student signed in and deletes nothing', async ({ page }) => {
  await signIn(page);
  await page.getByText('Signed in as').waitFor();
  await seedLocal(page, started('Unsaved work during an outage'));
  await fetch(`${S}/__down?on=1`);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('We could not confirm that your latest work is saved')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Signed in as')).toBeVisible();
  expect(await local(page)).toContain('Unsaved work during an outage');

  await page.getByRole('button', { name: 'Sign out and keep my work in this browser' }).click();
  await expect(page.getByText('Your latest work is only in this browser')).toBeVisible();
  expect(await local(page)).toContain('Unsaved work during an outage');
});

test('C2: leaving straight after an edit still saves', async ({ page }) => {
  await seedLocal(page, started());
  await signIn(page);
  await openWrite(page);
  await page.locator('#work').fill('Edited and left at once');
  await page.getByRole('link', { name: 'Check', exact: true }).click();
  await expect.poll(async () => (await state()).row?.data.steps.title.work).toBe('Edited and left at once');
});

test('C2: an edit stranded by a closed page is saved on the next visit', async ({ page }) => {
  await seedLocal(page, started('First'));
  await signIn(page);
  await page.goto('/');
  await expect(page.getByText(/Saved to your account/)).toBeVisible();
  const before = (await state()).writes;
  await page.goto('/guides');
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('path:v1')!);
    p.steps.title.work = 'Written just before the tab closed';
    p.savedAt = new Date().toISOString();
    localStorage.setItem('path:v1', JSON.stringify(p));
  });
  await page.goto('/');
  await expect.poll(async () => (await state()).writes).toBeGreaterThan(before);
  expect((await state()).row.data.steps.title.work).toBe('Written just before the tab closed');
});

test('honest status: a failed save is never shown as saved', async ({ page }) => {
  await seedLocal(page, started('Start'));
  await signIn(page);
  await openWrite(page);
  await expect(page.getByText(/Saved to your account/)).toBeVisible();
  await fetch(`${S}/__down?on=1`);
  await page.locator('#work').fill('Text during an outage');
  await expect(page.getByText(/Not confirmed as saved to your account/)).toBeVisible({ timeout: 20_000 });
  await fetch(`${S}/__down?on=0`);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText(/Saved to your account/)).toBeVisible();
  expect((await state()).row.data.steps.title.work).toBe('Text during an outage');
});

test('C4: an old device cannot overwrite newer work', async ({ page, browser }) => {
  await seedLocal(page, started('Original'));
  await signIn(page);
  await openWrite(page);
  await expect(page.getByText(/Saved to your account/)).toBeVisible();

  const other = await (await browser.newContext()).newPage();
  await signIn(other);
  await openWrite(other);
  await expect(other.locator('#work')).toHaveValue('Original');

  await page.locator('#work').fill('Newest work from device A');
  await expect.poll(async () => (await state()).row.data.steps.title.work).toBe('Newest work from device A');

  await other.locator('#work').fill('Old device edit');
  await expect(other.getByText('Two versions of your thesis exist.')).toBeVisible();
  expect((await state()).row.data.steps.title.work).toBe('Newest work from device A');

  await other.getByRole('button', { name: 'Use my account’s version' }).click();
  await expect(other.getByText('Two versions of your thesis exist.')).toBeHidden();
  await expect(other.locator('#work')).toHaveValue('Newest work from device A');
  expect(await other.evaluate(() => localStorage.getItem('path:replaced:v1'))).toContain('Old device edit');
  await other.context().close();
});

test('C4: choosing this browser saves it and keeps the other copy', async ({ page, browser }) => {
  await seedLocal(page, started('Original'));
  await signIn(page);
  await openWrite(page);
  await expect(page.getByText(/Saved to your account/)).toBeVisible();
  const other = await (await browser.newContext()).newPage();
  await signIn(other);
  await openWrite(other);
  await expect(other.locator('#work')).toHaveValue('Original');
  await page.locator('#work').fill('Device A version');
  await expect.poll(async () => (await state()).row.data.steps.title.work).toBe('Device A version');
  await other.locator('#work').fill('Device B version');
  await other.getByRole('button', { name: 'Keep this browser’s version' }).click();
  await expect.poll(async () => (await state()).row.data.steps.title.work).toBe('Device B version');
  expect(await other.evaluate(() => localStorage.getItem('path:replaced:v1'))).toContain('Device A version');
  await other.context().close();
});

test('C4: guest work and different account work are both offered', async ({ page }) => {
  await fetch(`${S}/__row`, { method: 'POST', body: JSON.stringify({ data: started('Work already in the account', { savedAt: '2026-10-01T00:00:00.000Z' }), updated_at: '2026-10-01T00:00:00+00:00' }) });
  await seedLocal(page, started('Different guest work'));
  await signIn(page);
  await page.goto('/');
  await expect(page.getByText('Two versions of your thesis exist.')).toBeVisible();
  expect((await state()).row.data.steps.title.work).toBe('Work already in the account');
  expect(await local(page)).toContain('Different guest work');
});

test('a second tab in one browser does not write over newer work', async ({ page, context }) => {
  await seedLocal(page, started('Original'));
  await openWrite(page);
  const second = await context.newPage();
  await openWrite(second);
  await page.locator('#work').fill('Newest text in the first tab');
  await expect(second.locator('#work')).toHaveValue('Newest text in the first tab');
  await second.getByRole('tab', { name: '1. Do' }).click();
  await second.locator('details').filter({ hasText: 'All tasks' }).first().click();
  await second.getByRole('checkbox').first().uncheck();
  expect(await local(second)).toContain('Newest text in the first tab');
});

test('C10: reset request gives the same reply for any address', async ({ page }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Forgot your password?' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('Email').fill('anyone@example.test');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('If an account exists for this email')).toBeVisible();
  expect((await state()).recover).toEqual(['anyone@example.test']);
});

const recoveryHash = () => {
  const b = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const at = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: 'x', exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', aud: 'authenticated', session_id: 'x' })}.sig`;
  return `#access_token=${at}&refresh_token=r&expires_in=3600&expires_at=${Math.floor(Date.now() / 1000) + 3600}&token_type=bearer&type=recovery`;
};

test('C10: a valid link lets the student choose a new password', async ({ page }) => {
  await page.goto(`/account/reset${recoveryHash()}`);
  await page.getByLabel('New password', { exact: true }).fill('fictional-pass-1');
  await page.getByLabel('Repeat new password').fill('different-pass-2');
  await page.getByRole('button', { name: 'Change my password' }).click();
  await expect(page.getByText('The two passwords do not match.')).toBeVisible();
  await page.getByLabel('Repeat new password').fill('fictional-pass-1');
  await page.getByRole('button', { name: 'Change my password' }).click();
  await expect(page.getByText('Your password has been changed.')).toBeVisible();
  expect((await state()).newPassword).toBe('fictional-pass-1');
});

test('C10: a recovery link landing on the home page still reaches the update form', async ({ page }) => {
  await page.goto(`/${recoveryHash()}`);
  await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
});

test('C10: expired links explain what to do', async ({ page }) => {
  await page.goto('/account/reset#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  await expect(page.getByText('This link is invalid or has expired.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible();
});

test('C10: being signed in without a link cannot open the form', async ({ page }) => {
  await signIn(page);
  await page.goto('/account/reset');
  await expect(page.getByText('This link is invalid or has expired.')).toBeVisible();
  await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
});

test('signed-out critique points to Account', async ({ page }) => {
  await seedLocal(page, started('Long enough fictional notes for a critique request'));
  await openWrite(page);
  await page.getByRole('button', { name: 'Get my critique' }).click();
  await expect(page.locator('.error')).toContainText('Sign in');
  await expect(page.locator('.error a')).toHaveAttribute('href', '/account');
});

test('signed-in critique with no AI explains what to do next', async ({ page }) => {
  await seedLocal(page, started('Long enough fictional notes for a critique request'));
  await signIn(page);
  await openWrite(page);
  await page.getByRole('button', { name: 'Get my critique' }).click();
  await expect(page.locator('.error')).toContainText("AI feedback isn't set up yet");
  await expect(page.locator('.error a')).toHaveAttribute('href', '/account');
});
