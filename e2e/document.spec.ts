import { expect, seed, started, stored, test } from './fixtures';

test('a new student is sent to start first', async ({ page }) => {
  await page.goto('/document');
  await expect(page.getByRole('link', { name: 'Start my thesis' })).toBeVisible();
});

test('the chosen structure carries into the document', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'I have no topic yet' }).check();
  await page.getByLabel('Thesis structure').selectOption('system');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('This step feeds:')).toBeVisible();
  await page.getByRole('link', { name: 'Document' }).click();
  await expect(page.getByRole('heading', { name: '5. Architecture and design' })).toBeVisible();
});

test('ingredients show their state and open their step', async ({ page }) => {
  await seed(page, { 'path:v1': started({ steps: { title: { work: 'Notes', checks: [0], status: 'open' }, literature: { work: 'Themes', checks: [], status: 'done' } } }) });
  await page.goto('/document');
  await expect(page.getByText('Your title and research question: In progress.').first()).toBeVisible();
  await expect(page.getByText('Your themes and the gap: Ready.')).toBeVisible();
  await page.getByRole('button', { name: 'Open the step Design your method' }).first().click();
  await expect(page.getByRole('heading', { level: 2, name: 'Design your method' })).toBeVisible();
});

test('a part saves the student text and counts words', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  await page.goto('/document');
  await page.getByRole('button', { name: 'Write this part' }).nth(1).click();
  await page.getByLabel('Your text for Introduction').fill('One two three four five');
  await expect(page.getByText('5 of at least 25,000 words in the main text')).toBeVisible();
  await page.reload();
  expect((await stored(page, 'path:v1')).parts.introduction).toBe('One two three four five');
  await expect(page.getByRole('button', { name: 'Continue writing' })).toBeVisible();
});

test('changing structure keeps written text', async ({ page }) => {
  await seed(page, { 'path:v1': started({ parts: { introduction: 'Kept text here' } }) });
  await page.goto('/document');
  await page.getByLabel('Structure').selectOption('studies');
  await expect(page.getByRole('heading', { name: '4. Study 1' })).toBeVisible();
  expect((await stored(page, 'path:v1')).parts.introduction).toBe('Kept text here');
});
