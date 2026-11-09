import { expect, seed, started, test } from './fixtures';

const pick = async (page: import('@playwright/test').Page, types: string[], os: string) => {
  for (const t of types) await page.getByRole('checkbox', { name: new RegExp(`^${t}`) }).check();
  await page.getByRole('radio', { name: os, exact: true }).check();
};
const cards = (page: import('@playwright/test').Page) => page.locator('.lab-card h3');

test('starts empty and asks what the research involves', async ({ page }) => {
  await page.goto('/lab');
  await expect(page.getByRole('heading', { level: 1, name: 'Lab' })).toBeVisible();
  await expect(page.getByText('Choose what your research involves to see your checklist.')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
});

test('suggests the system from the browser, and the student can change it', async ({ page }) => {
  await page.goto('/lab');
  // The test browser reports Windows.
  await expect(page.getByRole('radio', { name: 'Windows', exact: true })).toBeChecked();
  await expect(page.getByText('Suggested from your browser.')).toBeVisible();
  await page.getByRole('radio', { name: 'Linux', exact: true }).check();
  await expect(page.getByText('Suggested from your browser.')).toHaveCount(0);
});

test('statistics on Windows shows only the needed tools', async ({ page }) => {
  await page.goto('/lab');
  await pick(page, ['Statistical analysis'], 'Windows');
  await expect(cards(page)).toHaveText(['Python', 'pip', 'Python virtual environment (venv)', 'Git', 'Visual Studio Code', 'JupyterLab', 'NumPy', 'pandas', 'Matplotlib']);
  await expect(page.getByText('9 tools. 0 marked installed by you. None technically verified yet.')).toBeVisible();
  await expect(page.locator('.lab-card').first().locator('code').filter({ hasText: 'py install 3.13' })).toBeVisible();
});

test('deep learning asks about the GPU, and macOS skips NVIDIA', async ({ page }) => {
  await page.goto('/lab');
  await pick(page, ['Deep learning'], 'Linux');
  await page.getByRole('radio', { name: 'No', exact: true }).check();
  await expect(cards(page).filter({ hasText: 'PyTorch' })).toHaveCount(1);
  await expect(cards(page).filter({ hasText: 'NVIDIA' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Yes', exact: true }).check();
  await expect(cards(page).filter({ hasText: 'NVIDIA driver and CUDA' })).toHaveCount(1);
  await page.getByRole('radio', { name: 'macOS', exact: true }).check();
  await expect(page.getByText('Does that computer have an NVIDIA graphics card?')).toHaveCount(0);
  await expect(cards(page).filter({ hasText: 'NVIDIA' })).toHaveCount(0);
});

test('links go to official https pages in a new tab', async ({ page }) => {
  await page.goto('/lab');
  await pick(page, ['Deep learning'], 'Windows');
  const links = page.locator('.lab-links a');
  for (const a of await links.all()) {
    expect(await a.getAttribute('href')).toMatch(/^https:\/\//);
    await expect(a).toHaveAttribute('target', '_blank');
    await expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  }
  await expect(page.locator('.lab-card').filter({ has: page.getByRole('heading', { name: 'PyTorch', exact: true }) }).getByRole('link', { name: /Official download page/ })).toHaveAttribute('href', 'https://pytorch.org/get-started/locally/');
});

test('copy buttons copy the command text and run nothing', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/lab');
  await pick(page, ['Python programming'], 'Windows');
  await page.waitForLoadState('networkidle');
  const before = requests.filter((u) => !u.includes('/_next/')).length;
  await page.getByRole('button', { name: 'Copy command: python --version' }).click();
  await expect(page.getByRole('button', { name: 'Copy command: python --version' })).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('python --version');
  // No request is sent: the page never runs or sends a command.
  expect(requests.filter((u) => !u.includes('/_next/')).length).toBe(before);
});

test('marking a tool installed never claims it was verified, and is remembered', async ({ page }) => {
  await page.goto('/lab');
  await pick(page, ['Python programming'], 'Windows');
  const git = page.locator('.lab-card').filter({ has: page.getByRole('heading', { name: 'Git', exact: true }) });
  await expect(git.getByText('Not started. Not yet technically verified.')).toBeVisible();
  await git.getByRole('checkbox', { name: 'I followed the installation steps' }).check();
  await expect(git.getByText('Marked installed by you. Not yet technically verified.')).toBeVisible();
  await expect(page.getByText('5 tools. 1 marked installed by you. None technically verified yet.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('5 tools. 1 marked installed by you. None technically verified yet.')).toBeVisible();
});

test('the method and experiments steps link to the Lab', async ({ page }) => {
  await seed(page, { 'path:v1': started({ current: 'method' }) });
  await page.goto('/');
  await page.getByRole('link', { name: 'Set up your computer' }).click();
  await expect(page).toHaveURL(/\/lab$/);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('shows the PC advice, compact steps and no side scrolling', async ({ page }) => {
    await page.goto('/lab');
    await expect(page.getByText('Installing happens on a computer, not on a phone.')).toBeVisible();
    await pick(page, ['Deep learning'], 'Windows');
    const first = page.locator('.lab-card').first();
    await expect(first.locator('details').first()).not.toHaveAttribute('open', '');
    await expect(first.getByRole('link', { name: /Official download page/ })).toBeVisible();
    await first.locator('summary').first().click();
    await expect(first.locator('code').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

test('on a desktop, the PC advice is hidden and steps are open', async ({ page }) => {
  await page.goto('/lab');
  await expect(page.getByText('Installing happens on a computer, not on a phone.')).toBeHidden();
  await pick(page, ['Python programming'], 'Windows');
  await expect(page.locator('.lab-card').first().locator('details').first()).toHaveAttribute('open', '');
});
