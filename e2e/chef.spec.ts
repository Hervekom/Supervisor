import { expect, seed, started, stored, test } from './fixtures';

test('the chef opens with the next ingredient, without AI', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  await page.route('**/api/chef', (r) => r.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask Supervisor' }).click();
  await expect(page.getByRole('log')).toContainText('Understand the title you were given');
  await expect(page.getByRole('log')).toContainText('your title and research question for Introduction');
  await expect(page.getByRole('button', { name: 'I don’t have this yet' })).toBeVisible();
});

test('a new student is told where to begin', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask Supervisor' }).click();
  await expect(page.getByRole('log')).toContainText('Choose where you are');
});

test('a conversation sends the project, caps long replies and offers next replies', async ({ page }) => {
  await seed(page, { 'path:v1': started({ title: 'Fictional lanterns' }) });
  let body: { context?: { title?: string; step?: string } } = {};
  await page.route('**/api/chef', async (r) => { body = r.request().postDataJSON(); await r.fallback(); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask Supervisor' }).click();
  await page.getByLabel('Your message').fill('I am stuck');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('log')).toContainText('Mock chef reply.');
  expect(body.context).toMatchObject({ title: 'Fictional lanterns', step: 'title' });
  const words = (await page.locator('.chef-line.bot').last().innerText()).split(/\s+/).length;
  expect(words).toBeLessThanOrEqual(172);
  await expect(page.getByRole('button', { name: 'Open this step' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mock suggestion' }).click();
  await expect(page.locator('.chef-line.student')).toHaveCount(2);
  expect((await stored(page, 'path:v1')).log.map((l: { tool: string }) => l.tool)).toEqual(['Conversation with Supervisor']);
  await expect(page.locator('.chef-line.bot')).toHaveCount(3);
});

test('the chef can open a step, and the page follows', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask Supervisor' }).click();
  await page.getByLabel('Your message').fill('open method please');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Open this step' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Design your method' })).toBeVisible();
});

test('the conversation survives a reload, and a new one can start', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  await page.goto('/document');
  await page.getByRole('button', { name: 'Ask Supervisor' }).click();
  await page.getByLabel('Your message').fill('Remember this fictional line');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('log')).toContainText('Mock chef reply.');
  await page.reload();
  await page.getByRole('button', { name: 'Ask Supervisor' }).click();
  await expect(page.getByRole('log')).toContainText('Remember this fictional line');
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('log')).not.toContainText('Remember this fictional line');
});

test('a lost connection keeps the message and explains', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  await page.route('**/api/chef', (r) => r.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask Supervisor' }).click();
  await page.getByLabel('Your message').fill('Hello');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.chef .error')).toContainText("We couldn't reach Supervisor.");
  // Phase P4: the unanswered message goes back into the box, so sending it again does not repeat it in the conversation.
  await expect(page.getByLabel('Your message')).toHaveValue('Hello');
  await expect(page.locator('.chef-line.student')).toHaveCount(0);
});

test('the panel fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, { 'path:v1': started() });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ask Supervisor' }).click();
  const box = await page.locator('section.chef').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.height).toBeLessThanOrEqual(844);
});
