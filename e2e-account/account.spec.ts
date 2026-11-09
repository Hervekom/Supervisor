import { readFileSync } from 'fs';
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

// ---------- Lab progress (Phase B1) ----------

const labCard = (page: Page, name: string) => page.locator('.lab-card').filter({ has: page.getByRole('heading', { name, exact: true }) });

test('B1: a verified Lab result is saved with the thesis in the account', async ({ page }) => {
  await seedLocal(page, started('Thesis work that must stay'));
  await signIn(page);
  await expect(page.getByText('The work from this browser is saved to your account.')).toBeVisible();
  await page.goto('/lab');
  await page.getByRole('checkbox', { name: /^Python programming/ }).check();
  await page.getByRole('radio', { name: 'Windows', exact: true }).check();
  const py = labCard(page, 'Python');
  await py.getByLabel('Paste what the command printed').fill('Python 3.12.7');
  await py.getByRole('button', { name: 'Check output' }).click();
  await expect(py.getByTestId('status-python')).toHaveText('Verified');
  await expect.poll(async () => (await state()).row?.data?.lab?.tools?.python?.check?.status, { timeout: 15_000 }).toBe('verified');
  const row = (await state()).row.data;
  expect(row.steps.title.work).toBe('Thesis work that must stay');
  expect(JSON.stringify(row.lab)).not.toContain('3.12.7\n');
  await expect(page.getByText('Your Lab progress is saved with your thesis in your account.')).toBeVisible();
});

test('B1: Lab progress alone does not start a "two versions" choice, and survives sign-in', async ({ page }) => {
  await fetch(`${S}/__row`, { method: 'POST', body: JSON.stringify({ data: started('Work already in the account', { savedAt: '2026-10-01T00:00:00.000Z' }), updated_at: '2026-10-01T00:00:00+00:00' }) });
  await page.goto('/lab');
  await page.getByRole('checkbox', { name: /^Python programming/ }).check();
  await page.getByRole('radio', { name: 'Windows', exact: true }).check();
  await labCard(page, 'Git').getByRole('checkbox', { name: 'I followed the installation steps' }).check();
  await signIn(page);
  await page.goto('/lab');
  await expect(page.getByText(/Two versions/)).toHaveCount(0);
  await expect(labCard(page, 'Git').getByTestId('status-git')).toHaveText('Installation marked complete by you');
  // The account's thesis came in, and the Lab progress joined it.
  await expect.poll(async () => (await state()).row.data.lab?.tools?.git?.marked, { timeout: 15_000 }).toBe(true);
  expect((await state()).row.data.steps.title.work).toBe('Work already in the account');
});

// ---------- Experiment runs (Phase B2) ----------

test('B2: a reported run is saved with the thesis and appears on a second device', async ({ page, browser }) => {
  await seedLocal(page, started('Thesis work that must stay'));
  await signIn(page);
  await expect(page.getByText('The work from this browser is saved to your account.')).toBeVisible();
  await page.goto('/lab');
  await page.getByRole('button', { name: 'Add a run' }).click();
  await page.getByLabel('Run name').fill('Baseline, seed 1');
  await page.getByRole('button', { name: 'Add a result' }).click();
  await page.getByLabel('Result 1 name').fill('accuracy');
  await page.getByLabel('Result 1 value').fill('0.912');
  await page.getByRole('button', { name: 'Save run' }).click();
  await expect.poll(async () => (await state()).row?.data?.runs?.[0]?.name, { timeout: 15_000 }).toBe('Baseline, seed 1');
  const row = (await state()).row.data;
  expect(row.runs[0]).toMatchObject({ source: 'student', metrics: [{ name: 'accuracy', value: 0.912, split: 'test' }] });
  expect(row.steps.title.work).toBe('Thesis work that must stay');

  const other = await (await browser.newContext()).newPage();
  await signIn(other);
  await other.goto('/lab');
  await expect(other.getByTestId('run-card').getByRole('heading', { name: 'Baseline, seed 1' })).toBeVisible();
  await other.context().close();
});

// ---------- Phase B2.1 ----------

test('B2.1: a run step reaches a second device, and changing language saves nothing to the account', async ({ page, browser }) => {
  await seedLocal(page, started('Thesis work that must stay'));
  await signIn(page);
  await expect(page.getByText('The work from this browser is saved to your account.')).toBeVisible();
  await page.goto('/lab');
  await page.getByRole('button', { name: 'Add a run' }).click();
  await page.getByLabel('Research step').selectOption('experiments');
  await page.getByLabel('Run name').fill('Baseline, seed 1');
  await page.getByRole('button', { name: 'Add a result' }).click();
  await page.getByLabel('Result 1 name').fill('accuracy');
  await page.getByLabel('Result 1 value').fill('0.912');
  await page.getByRole('button', { name: 'Save run' }).click();
  await expect.poll(async () => (await state()).row?.data?.runs?.[0]?.stepId, { timeout: 15_000 }).toBe('experiments');

  const writes = (await state()).writes;
  await page.getByRole('button', { name: 'Français' }).click();
  await expect(page.getByRole('heading', { name: 'Expériences' })).toBeVisible();
  await page.waitForTimeout(2500);
  expect((await state()).writes).toBe(writes);
  expect((await state()).row.data.steps.title.work).toBe('Thesis work that must stay');

  const other = await (await browser.newContext()).newPage();
  await signIn(other);
  await other.goto('/lab');
  const card = other.getByTestId('run-card').filter({ has: other.getByRole('heading', { name: 'Baseline, seed 1' }) });
  await expect(card.getByText('Train your models')).toBeVisible();
  await other.goto('/document');
  await expect(other.getByTestId('research-evidence').getByText('1 linked to a step')).toBeVisible();
  await other.context().close();
});

// ---------- Phase B2.3 ----------

async function labVerifiedAsGuest(page: Page) {
  await page.goto('/lab');
  await page.getByRole('checkbox', { name: /^Python programming/ }).check();
  await page.getByRole('radio', { name: 'Windows', exact: true }).check();
  const py = page.locator('.lab-card').filter({ has: page.getByRole('heading', { name: 'Python', exact: true }) });
  await py.getByLabel('Paste what the command printed').fill('Python 3.12.7');
  await py.getByRole('button', { name: 'Check output' }).click();
  await expect(py.getByTestId('status-python')).toHaveText('Verified');
}

test('B2.3 D4: sign-out explains unsaved Lab progress; cancel, keep and delete all behave', async ({ page }) => {
  await labVerifiedAsGuest(page);
  await signIn(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText('Your Lab progress is not saved to your account.')).toBeVisible();
  await expect(dialog.getByText(/1 verified tool/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Signed in as')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Keep it in this browser and sign out' }).click();
  await expect(page.getByText('Your Lab progress stays in this browser.')).toBeVisible();
  // Since B2.3.2 (D-M1) kept progress stays with its account: signed out, this browser shows none of it,
  // and signing in again brings it back.
  await page.goto('/lab');
  await expect(page.getByRole('radio', { name: 'Windows', exact: true })).toBeVisible();
  await expect(page.getByText('Verified', { exact: true })).toHaveCount(0);
  await signIn(page);
  await page.goto('/lab');
  await expect(page.getByTestId('status-python')).toHaveText('Verified');

  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Delete it and sign out' }).click();
  await expect(page.getByText('Signed out. Your work is saved to your account.')).toBeVisible();
  expect(await page.evaluate(() => [localStorage.getItem('lab:v2'), localStorage.getItem('path:v1')])).toEqual([null, null]);
});

test('B2.3 D4: Lab progress travels with a started thesis, so sign-out asks nothing and loses nothing', async ({ page, browser }) => {
  await labVerifiedAsGuest(page);
  await seedLocal(page, started('Thesis work'));
  await signIn(page);
  await expect(page.getByText('The work from this browser is saved to your account.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('Signed out. Your work is saved to your account.')).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect((await state()).row.data.lab?.tools?.python?.check?.status).toBe('verified');
  const other = await (await browser.newContext()).newPage();
  await signIn(other);
  await other.goto('/lab');
  await expect(other.getByTestId('status-python')).toHaveText('Verified');
  await other.context().close();
});

test('B2.3 S1: the feedback route refuses requests without a session when sign-in is configured', async ({ request }) => {
  const r = await request.post('/api/runs/feedback', { data: { run: { id: 'run-123456', createdAt: '2026-11-09T00:00:00Z', name: 'x', metrics: [{ name: 'acc', value: 0.5, split: 'test' }] } } });
  expect(r.status()).toBe(401);
  expect(JSON.stringify(await r.json())).not.toMatch(/SUPABASE|LLM_|key=/i);
});

test('B2.3 D1: runs added on two devices can be kept together, and both versions are set aside', async ({ page, browser }) => {
  await seedLocal(page, started('Thesis'));
  await signIn(page);
  await expect(page.getByText('The work from this browser is saved to your account.')).toBeVisible();
  const other = await (await browser.newContext()).newPage();
  await signIn(other);
  await other.goto('/lab');
  await other.getByRole('button', { name: 'Add a run' }).waitFor();

  const add = async (p: Page, name: string) => {
    await p.getByRole('button', { name: 'Add a run' }).click();
    await p.getByLabel('Run name').fill(name);
    await p.getByRole('button', { name: 'Add a result' }).click();
    await p.getByLabel('Result 1 name').fill('accuracy');
    await p.getByLabel('Result 1 value').fill('0.8');
    await p.getByRole('button', { name: 'Save run' }).click();
  };
  await page.goto('/lab');
  await add(page, 'Run from device A');
  await expect.poll(async () => (await state()).row?.data?.runs?.length ?? 0, { timeout: 15_000 }).toBe(1);
  await add(other, 'Run from device B');
  await expect(other.getByText(/Two versions of your work exist/)).toBeVisible({ timeout: 15_000 });
  await other.goto('/');
  await expect(other.getByText('Only your experiment runs differ: 1 only in this browser, 1 only in your account.', { exact: false })).toBeVisible();
  await other.getByRole('button', { name: 'Keep the runs from both versions' }).click();
  await expect.poll(async () => ((await state()).row.data.runs ?? []).map((r: { name: string }) => r.name).sort(), { timeout: 15_000 }).toEqual(['Run from device A', 'Run from device B']);
  expect((await state()).row.data.steps.title.work).toBe('Thesis');
  const aside = await other.evaluate(() => JSON.parse(localStorage.getItem('path:replaced:list:v1') ?? '[]').length);
  expect(aside).toBeGreaterThanOrEqual(2);
  await other.context().close();
});

// ---------- Phase B2.3.2 ----------
// Two synthetic accounts share one browser. Their IDs come from the mock: …0001 is A, …0002 is B.
const A_ID = '00000000-0000-4000-8000-000000000001';
async function signInAs(page: Page, email: string) {
  await page.goto('/account');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
}
const signOutPlain = async (page: Page) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText(/^Signed out\./)).toBeVisible();
};
async function verifyPython(page: Page) {
  await page.goto('/lab');
  await page.getByRole('checkbox', { name: /^Python programming/ }).check();
  await page.getByRole('radio', { name: 'Windows', exact: true }).check();
  const py = page.locator('.lab-card').filter({ has: page.getByRole('heading', { name: 'Python', exact: true }) });
  await py.getByLabel('Paste what the command printed').fill('Python 3.12.7');
  await py.getByRole('button', { name: 'Check output' }).click();
  await expect(py.getByTestId('status-python')).toHaveText('Verified');
}
const verifiedCount = (page: Page) => page.getByText('Verified', { exact: true }).count();

test('B2.3.2 D-M1: Lab progress kept by account A is never seen, inherited or synced by account B, and A gets it back', async ({ page }) => {
  await signInAs(page, 'student@example.test');
  await verifyPython(page);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Keep it in this browser and sign out' }).click();
  await expect(page.getByText('Your Lab progress stays in this browser.')).toBeVisible();

  await signInAs(page, 'second@example.test');
  await page.goto('/lab');
  await expect(page.getByRole('radio', { name: 'Windows', exact: true })).toBeVisible();
  expect(await verifiedCount(page)).toBe(0);
  await expect(page.getByRole('checkbox', { name: /^Python programming/ })).not.toBeChecked();
  // Nothing of A's is offered to B either.
  await expect(page.getByRole('region', { name: 'Lab progress not linked to you' })).toHaveCount(0);
  // B starts a thesis: what B's account receives holds no Lab progress of A.
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('path:v1') ?? '{}');
    localStorage.setItem('path:v1', JSON.stringify({ ...p, topic: 'B thesis', current: 'title', started: true, situation: 'title', steps: { title: { work: 'B work', checks: [], status: 'open' } }, log: [], savedAt: new Date().toISOString() }));
  });
  await page.goto('/');
  await expect.poll(async () => (await state()).rows['00000000-0000-4000-8000-000000000002']?.data?.steps?.title?.work, { timeout: 15_000 }).toBe('B work');
  expect((await state()).rows['00000000-0000-4000-8000-000000000002'].data.lab).toBeUndefined();
  await signOutPlain(page);
  // A's progress is still in the browser, under A.
  const owners = await page.evaluate(() => JSON.parse(localStorage.getItem('lab:owners:v1') ?? '{}'));
  expect(owners[`user:${A_ID}`].tools.python.check.status).toBe('verified');

  await signInAs(page, 'student@example.test');
  await page.goto('/lab');
  await expect(page.getByTestId('status-python')).toHaveText('Verified');
  await page.reload();
  await expect(page.getByTestId('status-python')).toHaveText('Verified');
});

test('B2.3.2 D-M1: progress made signed out in another tab, or saved by an earlier version, is only offered, never taken', async ({ page, context }) => {
  // An earlier version kept progress without an owner.
  await page.goto('/guides');
  await page.evaluate(() => localStorage.setItem('lab:v2', JSON.stringify({ workTypes: ['python'], os: 'windows', gpu: 'no', osConfirmed: true, updatedAt: '2026-11-01T09:00:00.000Z', tools: { python: { check: { status: 'verified', os: 'windows', rule: 1, at: '2026-11-01T09:00:00.000Z', reason: 'ok', found: 'Python 3.12.7' } } } })));
  // Another tab, signed out, makes progress of its own.
  const tab = await context.newPage();
  await tab.goto('/lab');
  await tab.getByRole('checkbox', { name: /^Statistical analysis/ }).check();
  await expect.poll(() => tab.evaluate(() => localStorage.getItem('lab:owners:v1') ?? '')).toContain('statistics');
  await tab.close();

  await signInAs(page, 'student@example.test');
  await page.goto('/lab');
  const offer = page.getByRole('region', { name: 'Lab progress not linked to you' });
  await expect(offer).toBeVisible();
  await expect(offer.getByText(/^Saved by an earlier version/)).toBeVisible();
  await expect(offer.getByText(/^From an earlier signed-out session/)).toBeVisible();
  expect(await verifiedCount(page)).toBe(0);
  expect((await state()).row).toBeFalsy();

  // Download keeps a copy without changing anything.
  const [download] = await Promise.all([page.waitForEvent('download'), offer.getByRole('button', { name: 'Download it' }).first().click()]);
  const file = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(file.lab.tools.python.check.found).toBe('Python 3.12.7');
  expect(await page.evaluate(() => localStorage.getItem('lab:v2'))).not.toBeNull();

  // Claiming is explicit and explained; the other session's progress stays offered until removed.
  await offer.getByRole('button', { name: 'This is mine: use it' }).first().click();
  await expect(page.getByTestId('status-python')).toHaveText('Verified');
  expect(await page.evaluate(() => localStorage.getItem('lab:v2'))).toBeNull();
  await offer.getByRole('button', { name: 'Not mine: remove it from this browser' }).click();
  await offer.getByRole('button', { name: 'Remove it from this browser' }).click();
  await expect(page.getByRole('region', { name: 'Lab progress not linked to you' })).toHaveCount(0);
});

async function makeConflict(page: Page, accountWork: string, localWork: string) {
  await fetch(`${S}/__row`, { method: 'POST', body: JSON.stringify({ data: started(accountWork, { savedAt: '2026-10-01T00:00:00.000Z' }), updated_at: '2026-10-01T00:00:00+00:00' }) });
  await seedLocal(page, started(localWork));
}

test('B2.3.2 D-H1: a set-aside version is never deleted at sign-out without a warning; download, cancel, keep and delete', async ({ page }) => {
  await makeConflict(page, 'Account version', 'Browser version');
  await signInAs(page, 'student@example.test');
  await page.goto('/');
  await page.getByRole('button', { name: 'Keep this browser’s version' }).click();
  await expect.poll(async () => (await state()).row.data.steps.title.work).toBe('Browser version');

  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Set-aside versions in this browser' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText('1 set-aside version of your work is kept in this browser.')).toBeVisible();
  await expect(dialog.getByText(/not part of your account’s current version/)).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download the set-aside versions' }).click()]);
  const file = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(file.copies).toHaveLength(1);
  expect(file.copies[0].path.steps.title.work).toBe('Account version');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText(`Signed in as student@example.test`)).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Keep it in this browser and sign out' }).click();
  await expect(page.getByText('The set-aside version stays in this browser.')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('path:replaced:list:v1'))).toContain('Account version');

  // Reload and sign in again: the copy is still listed, and can be removed explicitly after export.
  await page.reload();
  await signInAs(page, 'student@example.test');
  const list = page.locator('.set-aside');
  await expect(list.getByText(/Fictional/)).toBeVisible();
  await list.getByRole('button', { name: 'Remove', exact: true }).click();
  await list.getByRole('button', { name: 'Keep it' }).click();
  expect(await page.evaluate(() => localStorage.getItem('path:replaced:list:v1'))).toContain('Account version');
  await list.getByRole('button', { name: 'Remove', exact: true }).click();
  await list.getByRole('button', { name: 'Remove this version' }).click();
  await expect(page.getByRole('heading', { name: 'Set-aside versions in this browser' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('Signed out. Your work is saved to your account.')).toBeVisible();
});

test('B2.3.2 D-H1: deleting at sign-out removes only what the student confirmed', async ({ page }) => {
  await makeConflict(page, 'Account version', 'Browser version');
  await signInAs(page, 'student@example.test');
  await page.goto('/');
  await page.getByRole('button', { name: 'Keep this browser’s version' }).click();
  await expect.poll(async () => (await state()).row.data.steps.title.work).toBe('Browser version');
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Delete it and sign out' }).click();
  await expect(page.getByText('Signed out. Your work is saved to your account.')).toBeVisible();
  expect(await page.evaluate(() => [localStorage.getItem('path:replaced:list:v1'), localStorage.getItem('path:replaced:v1')])).toEqual(['[]', null]);
});

test('B2.3.2 D-H1: with five set-aside versions, a sixth choice is blocked until one is exported or removed', async ({ page }) => {
  await makeConflict(page, 'Account version', 'Browser version');
  await page.evaluate((id) => {
    const copies = [0, 1, 2, 3, 4].map((i) => ({ at: `2026-10-0${i + 1}T00:00:00.000Z`, owner: id, path: { topic: `Old ${i}`, discipline: '', defenseDate: '', current: 'title', started: true, situation: 'title', steps: { title: { work: `Old ${i}`, checks: [], status: 'open' } }, log: [], savedAt: `2026-10-0${i + 1}T00:00:00.000Z` } }));
    localStorage.setItem('path:replaced:list:v1', JSON.stringify(copies));
  }, A_ID);
  await signInAs(page, 'student@example.test');
  await page.goto('/');
  await page.getByRole('button', { name: 'Keep this browser’s version' }).click();
  await expect(page.getByText('This browser already keeps 5 set-aside versions.')).toBeVisible();
  await page.waitForTimeout(1500);
  expect((await state()).row.data.steps.title.work).toBe('Account version');
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('path:replaced:list:v1') ?? '[]'))).toHaveLength(5);
  await page.getByRole('button', { name: 'Use my account’s version' }).click();
  await expect(page.getByText('This browser already keeps 5 set-aside versions.')).toBeVisible();
  await expect(page.locator('#work')).toHaveCount(0);

  const list = page.locator('.set-aside');
  await list.getByRole('button', { name: 'Remove', exact: true }).first().click();
  await list.getByRole('button', { name: 'Remove this version' }).click();
  await page.getByRole('button', { name: 'Keep this browser’s version' }).click();
  await expect.poll(async () => (await state()).row.data.steps.title.work).toBe('Browser version');
  const copies = JSON.parse(await page.evaluate(() => localStorage.getItem('path:replaced:list:v1') ?? '[]'));
  expect(copies).toHaveLength(5);
  expect(copies.map((c: { path: { topic: string; steps: { title: { work: string } } } }) => c.path.steps.title.work)).toContain('Account version');
});

for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]] as const) {
  test(`B2.3.2 U-L1: the sign-out dialog takes, keeps and returns keyboard focus (${label})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await labVerifiedAsGuest(page);
    await signIn(page);
    const open = page.getByRole('button', { name: 'Sign out' });
    await open.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAccessibleName('Before you sign out');
    const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role=alertdialog]'));
    expect(await inside()).toBe(true);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await inside()).toBe(true);
    }
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await inside()).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
    await expect(page.getByText('Signed in as')).toBeVisible();
    // Cancel returns focus too.
    await open.click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(open).toBeFocused();
  });
}

test('B2.3.2 D-M1: kept progress survives closing the browser tab, and stays with its account', async ({ page, context }) => {
  await signInAs(page, 'student@example.test');
  await verifyPython(page);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Keep it in this browser and sign out' }).click();
  await expect(page.getByText('Your Lab progress stays in this browser.')).toBeVisible();
  await page.close();
  // A new tab has a new signed-out session, as after a browser restart. The progress is not offered to it.
  const again = await context.newPage();
  await again.goto('/lab');
  await expect(again.getByRole('radio', { name: 'Windows', exact: true })).toBeVisible();
  expect(await verifiedCount(again)).toBe(0);
  await expect(again.getByRole('region', { name: 'Lab progress not linked to you' })).toHaveCount(0);
  await signInAs(again, 'student@example.test');
  await again.goto('/lab');
  await expect(again.getByTestId('status-python')).toHaveText('Verified');
});
