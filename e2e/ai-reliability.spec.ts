import type { Page } from '@playwright/test';
import { expect, seed, started, stored, test } from './fixtures';

// Phase P4: AI failures. Synthetic text only. The mock provider fails on demand when the text carries a marker.
const body = (marker = '') => `Chapter 3 studies the fictional lantern method ${marker}, a synthetic approach invented only for this test. It explains each design choice in plain words, compares it with two baselines under the same conditions, and states its limits for the examiners.`;
const reports = async (page: Page) => ((await stored(page, 'path:v1'))?.chapterFeedback ?? []) as unknown[];
async function ask(page: Page, text: string) {
  await page.getByLabel('Chapter name').fill('Chapter 3 Method');
  await page.getByLabel('Chapter text').fill(text);
  await page.getByRole('button', { name: 'Get feedback' }).click();
}

test('a malformed provider reply is retried on the server, and one report is saved', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  await page.goto('/feedback');
  await ask(page, body('P4-MALFORMED-ONCE-feedback1'));
  // Two provider calls with a short wait between them: allow for a busy test machine.
  await expect(page.getByText('Saved to your feedback history.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Mock chapter feedback.')).toBeVisible();
  expect(await reports(page)).toHaveLength(1);
});

test('a provider 429 is explained, the text stays, and the site limits are shown', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  await page.goto('/feedback');
  await expect(page.getByText(/Free AI: up to 10 requests a minute and 80 a day per account\. Supervisor cannot show exactly how many remain/)).toBeVisible();
  const text = body('P4-STATUS-429-feedback2');
  await ask(page, text);
  await expect(page.locator('div.error')).toContainText('The free AI is busy with many students right now. Your text is still here, nothing was lost.');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByLabel('Chapter text')).toHaveValue(text);
  expect(await reports(page)).toHaveLength(0);
});

test('a provider 401 on the site key is not offered again and blames no student key', async ({ page }) => {
  await page.goto('/feedback');
  await ask(page, body('P4-STATUS-401-feedback3'));
  await expect(page.locator('div.error')).toContainText("The site's AI is not available because of a problem on our side.");
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('a provider 500 is explained after one server retry', async ({ page }) => {
  await page.goto('/feedback');
  await ask(page, body('P4-STATUS-500-feedback4'));
  await expect(page.locator('div.error')).toContainText('The AI service is having problems right now.');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('Try again sends the same request, and the answer is saved once', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  let calls = 0;
  await page.route('**/api/feedback', async (r) => {
    calls++;
    if (calls === 1) return r.fulfill({ status: 503, json: { error: 'The AI service is having problems right now. Your text is still here, nothing was lost. Try again in a few minutes.', code: 'provider_down', retryable: true } });
    return r.fallback();
  });
  await page.goto('/feedback');
  const text = body();
  await ask(page, text);
  await expect(page.locator('div.error')).toContainText('having problems');
  await page.getByLabel('Chapter text').fill('The student keeps typing after the failure.');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Saved to your feedback history.')).toBeVisible();
  const [r] = (await reports(page)) as { snapshot: { text: string }; requestId: string }[];
  // The report is for the text that was sent, not what was typed afterwards.
  expect(r.snapshot.text).toBe(text);
  expect(r.requestId).toBeTruthy();
  expect(await reports(page)).toHaveLength(1);
  expect(calls).toBe(2);
});

test('a dropped connection is retried once silently', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  let calls = 0;
  await page.route('**/api/feedback', (r) => (++calls === 1 ? r.abort('connectionreset') : r.fallback()));
  await page.goto('/feedback');
  await ask(page, body());
  await expect(page.getByText('Saved to your feedback history.')).toBeVisible();
  expect([calls, (await reports(page)).length]).toEqual([2, 1]);
});

test('the platform time limit is explained, never resent automatically, and nothing is saved', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  let calls = 0;
  await page.route('**/api/feedback', (r) => { calls++; return r.fulfill({ status: 504, contentType: 'text/html', body: '<html>Gateway Timeout</html>' }); });
  await page.goto('/feedback');
  const text = body();
  await ask(page, text);
  await expect(page.locator('div.error')).toContainText('Supervisor took too long to answer. Your text is still here, nothing was lost.');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByLabel('Chapter text')).toHaveValue(text);
  expect([calls, (await reports(page)).length]).toEqual([1, 0]);
});

test('a failed critique keeps the work and can be tried again', async ({ page }) => {
  const notes = 'Synthetic notes about a fictional lantern topic. ';
  await seed(page, { 'path:v1': started({ steps: { title: { work: notes.repeat(4), checks: [0, 1, 2, 3, 4], status: 'open' } } }) });
  let calls = 0;
  await page.route('**/api/coach', async (r) => (++calls === 1 ? r.fulfill({ status: 429, json: { error: 'You are sending requests quickly. Please wait about 20 seconds, then try again. Your work is safe.', code: 'site_minute_limit', retryable: true, retryAfter: 20 } }) : r.fallback()));
  await page.goto('/');
  await page.getByRole('tab', { name: '2. Write' }).click();
  await page.getByRole('button', { name: 'Get my critique' }).click();
  await expect(page.locator('.error')).toContainText('Please wait about 20 seconds');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Mock critique summary.')).toBeVisible();
  const p = await stored(page, 'path:v1');
  expect(p.steps.title.work).toBe(notes.repeat(4));
  expect(p.steps.title.rounds).toBe(1);
});

test('a failed conversation message goes back into the box, not into the conversation', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/chef', (r) => (++calls <= 2 ? r.fulfill({ status: 503, json: { error: 'The AI service is having problems right now. Your text is still here, nothing was lost.', code: 'provider_down', retryable: true } }) : r.fallback()));
  await page.goto('/guides');
  await page.getByRole('button', { name: 'Ask Supervisor' }).click();
  await page.getByLabel('Your message').fill('My synthetic question about lanterns');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'having problems' })).toBeVisible();
  await expect(page.getByLabel('Your message')).toHaveValue('My synthetic question about lanterns');
  await expect(page.locator('.chef-line.student')).toHaveCount(0);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByLabel('Your message')).toHaveValue('My synthetic question about lanterns');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText(/Mock chef reply/)).toBeVisible();
  await expect(page.locator('.chef-line.student')).toHaveCount(1);
});

test('chapter feedback history and experiment runs stay intact through failures', async ({ page }) => {
  const run = { id: 'run-p4-0001', source: 'student', step: 'experiments', outcome: 'completed', name: 'Synthetic baseline', purpose: '', dataset: '', split: '', model: '', settings: '', seeds: '', versions: '', hardware: '', duration: '', metrics: [], log: '', notes: '', createdAt: '2026-11-09T08:00:00.000Z', updatedAt: '2026-11-09T08:00:00.000Z' };
  const old = { id: 'r-old', stepId: 'draft', chapter: 'Chapter 3 Method', analyzedAt: '2026-11-09T08:00:00.000Z', status: 'current', fingerprint: 'fp-old', snapshot: { version: '0011223344556677', text: 'Synthetic earlier text.', totalChars: 23, words: 3 }, feedback: { summary: 'Synthetic earlier feedback.', strengths: [], issues: [], next_steps: [] }, settings: { degree: 'master_academic', discipline: '', language: 'English' } };
  await seed(page, { 'path:v1': started({ runs: [run] as never, chapterFeedback: [old] as never }) });
  await page.route('**/api/feedback', (r) => r.fulfill({ status: 502, json: { error: 'The AI service is having problems right now.', code: 'provider_down', retryable: true } }));
  await page.goto('/feedback');
  await ask(page, body());
  await expect(page.locator('div.error')).toContainText('having problems');
  const p = await stored(page, 'path:v1');
  expect(p.chapterFeedback).toEqual([old]);
  expect(p.runs).toEqual([run]);
});
