import { buildSyntheticPdf } from '../tests/helpers/syntheticThesis';
import { expect, seed, started, stored, test } from './fixtures';

const zipless = { name: 'bad.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('not a zip '.repeat(30)) };
const notes = 'A fictional sentence about lanterns. ';

test('C1: a PDF can start a thesis', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'I already have a proposal' }).check();
  await page.locator('#start-file').setInputFiles({
    name: 'proposal.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(buildSyntheticPdf(['A fictional proposal page with enough readable text to pass the shortest length check.'])),
  });
  await expect(page.getByText('proposal.pdf is ready.')).toBeVisible();
  await expect(page.getByText(/All \d+ characters were read/)).toBeVisible();
});

for (const [where, open] of [
  ['start', async (p: import('@playwright/test').Page) => { await p.goto('/'); await p.getByRole('radio', { name: 'I already have a proposal' }).check(); return p.locator('#start-file'); }],
  ['feedback', async (p: import('@playwright/test').Page) => { await p.goto('/feedback'); return p.locator('#f'); }],
] as const) {
  test(`C7: a damaged file gets a plain message on ${where}`, async ({ page }) => {
    const input = await open(page);
    await input.setInputFiles(zipless);
    await expect(page.locator('.error')).toHaveText("We couldn't open this document. Please save it again as DOCX and try again.");
  });
}

test('C7: a damaged file gets a plain message on check', async ({ page }) => {
  await page.goto('/check');
  await expect(page.locator('#uni option')).not.toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles(zipless);
  await page.getByRole('button', { name: 'Check my thesis' }).click();
  await expect(page.locator('.error')).toHaveText("We couldn't open this document. Please save it again as DOCX and try again.");
});

test('C7: a damaged PDF hides every technical detail', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'I already have a proposal' }).check();
  await page.locator('#start-file').setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf '.repeat(30)) });
  await expect(page.locator('.error')).toContainText("We couldn't open this PDF.");
  await expect(page.locator('.error')).not.toContainText(/worker|node_modules|var\/task/);
});

test('C7 (P2): Word Check has no 4 MB limit any more; a file that is not a Word file gets the plain message instead', async ({ page }) => {
  await page.goto('/check');
  await expect(page.locator('#uni option')).not.toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles({ name: 'large.docx', mimeType: 'application/octet-stream', buffer: Buffer.alloc(4_100_000) });
  await page.getByRole('button', { name: 'Check my thesis' }).click();
  await expect(page.locator('.error')).toHaveText("We couldn't open this document. Please save it again as DOCX and try again.");
});

test('C11: Feedback shows the platform 413 instead of failing silently', async ({ page }) => {
  await page.route('**/api/chapters', (r) => r.fulfill({ status: 413, contentType: 'text/plain', body: 'Request Entity Too Large' }));
  await page.goto('/feedback');
  await page.locator('#f').setInputFiles({ name: 'small.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await expect(page.locator('.error')).toContainText('larger than 4 MB');
});

test('C11: Feedback shows that it is reading a file', async ({ page }) => {
  await page.route('**/api/chapters', async (r) => {
    await new Promise((d) => setTimeout(d, 700));
    await r.fulfill({ json: { chapters: [{ title: 'Chapter 1', text: 'Fictional text' }], references: [] } });
  });
  await page.goto('/feedback');
  await page.locator('#f').setInputFiles({ name: 'small.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await expect(page.getByText('Reading your file…')).toBeVisible();
  await expect(page.getByText('small.docx is ready.')).toBeVisible();
});

test('C7: a lost connection during critique is explained', async ({ page }) => {
  await seed(page, { 'path:v1': started({ steps: { title: { work: notes.repeat(3), checks: [0, 1, 2, 3, 4], status: 'open' } } }) });
  await page.route('**/api/coach', (r) => r.abort());
  await page.goto('/');
  await page.getByRole('tab', { name: '2. Write' }).click();
  await page.getByRole('button', { name: 'Get my critique' }).click();
  await expect(page.locator('.error')).toContainText("We couldn't reach Supervisor.");
  expect((await stored(page, 'path:v1')).steps.title.work).toContain('lanterns');
});

test('C5: a long upload says exactly how much was read, then and later', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'I have a full draft' }).check();
  await page.locator('#start-file').setInputFiles({ name: 'long.txt', mimeType: 'text/plain', buffer: Buffer.from(notes.repeat(5000)) });
  await expect(page.getByRole('alert').filter({ hasText: 'Only part of this file was read' })).toContainText('60,000 of 185,000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('only its first 60,000 of 185,000 characters were read')).toBeVisible();
  await page.reload();
  await expect(page.getByText('only its first 60,000 of 185,000 characters were read')).toBeVisible();
});

test('C5: a shortened critique says what it read and cannot say ready', async ({ page }) => {
  await seed(page, { 'path:v1': started({ steps: { title: { work: notes.repeat(1000), checks: [0, 1, 2, 3, 4], status: 'open' } } }) });
  await page.goto('/');
  await page.getByRole('tab', { name: '2. Write' }).click();
  await expect(page.getByText('The critique reads the first 20,000 of your 37,000 characters.')).toBeVisible();
  await page.getByRole('button', { name: 'Get my critique' }).click();
  await expect(page.getByText('This critique read only the first 20,000 of 37,000 characters.')).toBeVisible();
  await expect(page.locator('.verdict .badge')).toHaveText('Almost there');
});

test('C5: a complete critique says so', async ({ page }) => {
  await seed(page, { 'path:v1': started({ steps: { title: { work: notes.repeat(3), checks: [0, 1, 2, 3, 4], status: 'open' } } }) });
  await page.goto('/');
  await page.getByRole('tab', { name: '2. Write' }).click();
  await page.getByRole('button', { name: 'Get my critique' }).click();
  await expect(page.getByText('This critique read all 111 characters of your work for this step.')).toBeVisible();
});

test('C5: chapter feedback states its coverage', async ({ page }) => {
  await page.goto('/feedback');
  await page.getByLabel('Chapter text').fill(notes.repeat(1200));
  await expect(page.getByText('Feedback reads the first 40,000 of these 44,400 characters.')).toBeVisible();
  await page.getByRole('button', { name: 'Get feedback' }).click();
  await expect(page.getByText('This feedback covers only the first 40,000 of 44,400 characters.')).toBeVisible();
});

test('the reset page handles a server with no accounts', async ({ page }) => {
  await page.goto('/account/reset');
  await expect(page.getByText('This link is invalid or has expired.')).toBeVisible();
});
