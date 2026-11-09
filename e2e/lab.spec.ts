import { expect, seed, started, stored, test } from './fixtures';

const pick = async (page: import('@playwright/test').Page, types: string[], os: string) => {
  for (const t of types) await page.getByRole('checkbox', { name: new RegExp(`^${t}`) }).check();
  await page.getByRole('radio', { name: os, exact: true }).check();
};
const cards = (page: import('@playwright/test').Page) => page.locator('.lab-card h3');
const card = (page: import('@playwright/test').Page, name: string) => page.locator('.lab-card').filter({ has: page.getByRole('heading', { name, exact: true }) });

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
  await expect(page.getByTestId('lab-summary')).toHaveText('9 tools. 0 verified. 0 marked complete by you, not yet checked. 0 need attention.');
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
  const git = card(page, 'Git');
  await expect(git.getByTestId('status-git')).toHaveText('Not started');
  await git.getByRole('checkbox', { name: 'I followed the installation steps' }).check();
  await expect(git.getByTestId('status-git')).toHaveText('Installation marked complete by you');
  await expect(git.getByText('Verification: Not checked yet.')).toBeVisible();
  await expect(page.getByTestId('lab-summary')).toHaveText('5 tools. 0 verified. 1 marked complete by you, not yet checked. 0 need attention.');
  await page.reload();
  await expect(page.getByTestId('lab-summary')).toHaveText('5 tools. 0 verified. 1 marked complete by you, not yet checked. 0 need attention.');
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

// ---------- Phase B1: checking pasted output ----------

const paste = async (page: import('@playwright/test').Page, name: string, text: string) => {
  const c = card(page, name);
  await c.getByLabel('Paste what the command printed').fill(text);
  await c.getByRole('button', { name: 'Check output' }).click();
  return c;
};

test('correct Python output is verified, and only the result is kept', async ({ page }) => {
  await page.goto('/lab');
  await pick(page, ['Python programming'], 'Windows');
  const py = card(page, 'Python');
  await py.getByLabel('Paste what the command printed').fill('C:\\proj>python --version\nPython 3.12.7');
  await expect(py.getByTestId('status-python')).toHaveText('Verification pending');
  await py.getByRole('button', { name: 'Check output' }).click();
  await expect(py.getByTestId('status-python')).toHaveText('Verified');
  await expect(py.getByText('Verification: Verified. Found Python 3.12.7 on Windows.')).toBeVisible();
  await expect(py.getByText('This confirms the output you pasted, not your whole computer.')).toBeVisible();
  await expect(py.getByLabel('Paste what the command printed')).toHaveValue('');
  const saved = await stored(page, 'path:v1');
  expect(saved.lab.tools.python.check).toMatchObject({ status: 'verified', os: 'windows', found: 'Python 3.12.7' });
  expect(JSON.stringify(saved)).not.toContain('C:\\\\proj');
  await page.reload();
  await expect(card(page, 'Python').getByTestId('status-python')).toHaveText('Verified');
});

test('wrong, unrelated and empty output is never verified, and says what to do next', async ({ page }) => {
  await page.goto('/lab');
  await pick(page, ['Python programming'], 'Windows');
  let py = await paste(page, 'Python', 'Python 3.8.10');
  await expect(py.getByTestId('status-python')).toHaveText('Verification failed');
  await expect(py.getByText('Next: Install a newer Python 3 from python.org')).toBeVisible();

  const git = await paste(page, 'Git', 'I installed it, trust me. Version 2.4');
  await expect(git.getByTestId('status-git')).toHaveText('Verification failed');
  await expect(git.getByText('This does not look like the output of git --version.')).toBeVisible();

  const code = card(page, 'Visual Studio Code');
  await code.getByRole('button', { name: 'Check output' }).click();
  await expect(code.getByText('Paste the output first.')).toBeVisible();
  await expect(code.getByTestId('status-vscode')).toHaveText('Not started');
  await expect(page.getByTestId('lab-summary')).toHaveText('5 tools. 0 verified. 0 marked complete by you, not yet checked. 2 need attention.');

  py = await paste(page, 'Python', 'Python 3.13.1');
  await expect(py.getByTestId('status-python')).toHaveText('Verified');
});

test('pip and Git outputs are checked with their own rules', async ({ page }) => {
  await page.goto('/lab');
  await pick(page, ['Python programming'], 'Windows');
  const pip = await paste(page, 'pip', 'pip 24.3.1 from C:\\Users\\student\\proj\\.venv\\Lib\\site-packages\\pip (python 3.12)');
  await expect(pip.getByTestId('status-pip')).toHaveText('Verified');
  await expect(pip.getByText('Found pip 24.3.1 (Python 3.12) on Windows.')).toBeVisible();
  const git = await paste(page, 'Git', 'git version 2.47.1.windows.1');
  await expect(git.getByTestId('status-git')).toHaveText('Verified');
  // The output of one tool is not proof for another.
  const venv = await paste(page, 'Python virtual environment (venv)', 'git version 2.47.1.windows.1');
  await expect(venv.getByTestId('status-venv')).toHaveText('Verification failed');
  expect(JSON.stringify(await stored(page, 'path:v1'))).not.toContain('student');
});

test('an environment with another name needs manual review', async ({ page }) => {
  await page.goto('/lab');
  await pick(page, ['Python programming'], 'Windows');
  const venv = await paste(page, 'Python virtual environment (venv)', 'C:\\proj\\myenv\\Scripts\\python.exe');
  await expect(venv.getByTestId('status-venv')).toHaveText('Manual review required');
  await expect(venv.getByText(/Next: If you created it on purpose/)).toBeVisible();
});

test('sensitive information is flagged, and secrets are never checked', async ({ page }) => {
  await page.goto('/lab');
  await pick(page, ['Python programming'], 'Windows');
  const pip = card(page, 'pip');
  await pip.getByLabel('Paste what the command printed').fill('pip 24.3.1 from C:\\Users\\student\\x\\pip (python 3.12)');
  await expect(pip.getByRole('alert')).toContainText('a file path that may show your user name');
  const py = card(page, 'Python');
  await py.getByLabel('Paste what the command printed').fill('Python 3.12.7\nOPENAI_API_KEY=sk-abcdefghijklmnop1234');
  await expect(py.getByRole('alert')).toContainText('Remove it before checking.');
  await py.getByRole('button', { name: 'Check output' }).click();
  await expect(py.getByText(/It was not checked/)).toBeVisible();
  await expect(py.getByTestId('status-python')).toHaveText('Verification pending');
  expect(JSON.stringify(await stored(page, 'path:v1'))).not.toContain('sk-abc');
});

test('checking output sends nothing over the network', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/lab');
  await pick(page, ['Python programming'], 'Windows');
  await page.waitForLoadState('networkidle');
  const before = requests.filter((u) => !u.includes('/_next/')).length;
  await paste(page, 'Python', 'Python 3.12.7');
  await expect(card(page, 'Python').getByTestId('status-python')).toHaveText('Verified');
  expect(requests.filter((u) => !u.includes('/_next/')).length).toBe(before);
});

test('a result for another system does not count', async ({ page }) => {
  await page.goto('/lab');
  await pick(page, ['Python programming'], 'Windows');
  await paste(page, 'Git', 'git version 2.47.1.windows.1');
  await page.getByRole('radio', { name: 'Linux', exact: true }).check();
  const git = card(page, 'Git');
  await expect(git.getByTestId('status-git')).toHaveText('Not started');
  await expect(git.getByText('Your earlier result was for Windows. Run the check again on Linux.')).toBeVisible();
});

test('the Lab keeps the thesis untouched, and reads progress saved before this version', async ({ page }) => {
  const thesis = started({ current: 'method', steps: { title: { work: 'Fictional title work', checks: [0], status: 'open' } } });
  await seed(page, { 'path:v1': thesis, 'lab:v1': { workTypes: ['python'], os: 'linux', gpu: 'not_sure', marked: { git: true }, osConfirmed: true } });
  await page.goto('/lab');
  await expect(card(page, 'Git').getByTestId('status-git')).toHaveText('Installation marked complete by you');
  await expect(page.getByRole('radio', { name: 'Linux', exact: true })).toBeChecked();
  await paste(page, 'Git', 'git version 2.43.0');
  const saved = await stored(page, 'path:v1');
  const { lab, savedAt, ...rest } = saved;
  const { savedAt: _old, ...before } = thesis;
  expect(rest).toEqual(before);
  expect(lab.tools.git).toMatchObject({ marked: true, check: { status: 'verified', os: 'linux' } });
  await page.goto('/');
  await expect(page.getByText('Fictional title work')).toHaveCount(0); // the method step is open, not the title step
  expect((await stored(page, 'path:v1')).steps.title.work).toBe('Fictional title work');
});

test('works without an account, offline', async ({ page, context }) => {
  await page.goto('/lab');
  await pick(page, ['Python programming'], 'Windows');
  await context.setOffline(true);
  await paste(page, 'Python', 'Python 3.12.7');
  await expect(card(page, 'Python').getByTestId('status-python')).toHaveText('Verified');
  await expect(page.getByText('Your Lab progress is saved in this browser.')).toBeVisible();
  await context.setOffline(false);
});

test.describe('pasting on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('the student can paste and check, and the Ask Supervisor button steps aside while typing', async ({ page }) => {
    await page.goto('/lab');
    await pick(page, ['Python programming'], 'Windows');
    await expect(page.getByText('Installing happens on a computer, not on a phone.')).toBeVisible();
    const ask = page.getByRole('button', { name: 'Ask Supervisor' });
    await expect(ask).toBeVisible();
    const py = card(page, 'Python');
    await py.getByLabel('Paste what the command printed').fill('Python 3.12.7');
    await expect(ask).toBeHidden();
    const box = await py.getByRole('button', { name: 'Check output' }).boundingBox();
    expect(box && box.width > 40).toBeTruthy();
    await py.getByRole('button', { name: 'Check output' }).click();
    await expect(py.getByTestId('status-python')).toHaveText('Verified');
    await expect(ask).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
