import { STEPS } from '../src/lib/path';
import { expect, seed, started, stored, test } from './fixtures';

test('every one of the 21 steps can be opened', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'My thesis' })).toBeVisible();
  for (const [i, s] of STEPS.entries()) {
    const button = page.locator('.stepbtn', { hasText: s.title }).first();
    await button.evaluate((b) => ((b.closest('details') as HTMLDetailsElement).open = true));
    await button.click();
    await expect(page.getByRole('heading', { level: 2, name: s.title })).toBeVisible();
    await expect(page.getByText(`Step ${i + 1} of 21`, { exact: false })).toBeVisible();
  }
  expect((await stored(page, 'path:v1')).current).toBe('archive');
});

test('a step runs through Do, Write and Critique, then moves on', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  await page.goto('/');
  const step = STEPS[0];
  await expect(page.getByRole('tab', { name: '1. Do' })).toHaveAttribute('aria-selected', 'true');

  for (const t of step.tasks) {
    await expect(page.getByRole('heading', { level: 3, name: t.do })).toBeVisible();
    await page.getByRole('button', { name: 'Done, next' }).click();
  }

  await expect(page.getByRole('tab', { name: '2. Write' })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel(step.workLabel).fill('My fictional notes on this step.');
  await page.getByRole('button', { name: 'Get my critique' }).click();

  await expect(page.getByRole('tab', { name: '3. Critique' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Mock critique summary.')).toBeVisible();
  await expect(page.getByText('Ready to move on')).toBeVisible();
  await expect(page.getByText('Mock examiner question?')).toBeVisible();

  const after = await stored(page, 'path:v1');
  expect(after.steps.title.rounds).toBe(1);
  expect(after.log).toHaveLength(1);

  await page.getByRole('button', { name: 'Finish, go to the next step' }).click();
  await expect(page.getByRole('heading', { level: 2, name: STEPS[1].title })).toBeVisible();
  await expect(page.getByText('1 of 21 steps finished')).toBeVisible();
  expect((await stored(page, 'path:v1')).steps.title.status).toBe('done');
});

test('a personal AI key goes with the request', async ({ page }) => {
  const key = { provider: 'kimi', apiKey: 'fake-key-123456', model: 'fake-model' };
  await seed(page, {
    'ai:v1': key,
    'path:v1': started({ steps: { title: { work: 'Fictional notes', checks: [0, 1, 2, 3, 4, 5, 6, 7], status: 'open' } } }),
  });
  const bodies: Record<string, { llm?: unknown }> = {};
  await page.route('**/api/guide', async (r) => {
    bodies.guide = r.request().postDataJSON();
    await r.fulfill({ json: { intro: 'Tailored intro.', tasks: [] } });
  });
  await page.route('**/api/coach', async (r) => {
    bodies.coach = r.request().postDataJSON();
    await r.fulfill({ json: { verdict: 'almost', summary: 'Personal key critique.', criteria: [], weakest: '', questions: [], next_action: '' } });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: '3. Critique' }).click();
  await page.getByRole('button', { name: /^Critique/ }).click();
  await expect(page.getByText('Personal key critique.')).toBeVisible();
  expect(bodies.coach.llm).toEqual(key);
  expect(bodies.guide.llm).toEqual(key);
});

test('saved progress from the current release still opens', async ({ page }) => {
  await seed(page, {
    'path:v1': started({ current: 'literature', steps: { title: { work: 'Saved notes', checks: [0], status: 'done' } }, log: [{ at: '2026-11-04T10:00:00.000Z', step: 'title', tool: 'AI reviewer critique' }] }),
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2, name: STEPS.find((s) => s.id === 'literature')!.title })).toBeVisible();
  await expect(page.getByText('1 of 21 steps finished')).toBeVisible();
});
