import { buildSyntheticThesis } from '../tests/helpers/syntheticThesis';
import { expect, test } from './fixtures';

const file = async () => ({
  name: 'synthetic-thesis.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  buffer: Buffer.from(await buildSyntheticThesis()),
});

test('asks for a file first', async ({ page }) => {
  await page.goto('/check');
  await page.getByRole('button', { name: 'Check my thesis' }).click();
  await expect(page.locator('.error')).toHaveText('Choose your thesis file first.');
});

test('checks a synthetic thesis and shows its sources', async ({ page }) => {
  await page.goto('/check');
  await expect(page.locator('#uni option')).not.toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles(await file());
  await expect(page.getByText('synthetic-thesis.docx')).toBeVisible();
  await page.getByRole('button', { name: 'Check my thesis' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /to fix$/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ask your graduate school' })).toBeVisible();
  await expect(page.getByText('Would your argument survive a reviewer?')).toBeVisible();
  await expect(page.getByText('Show the rule').first()).toBeVisible();
});

test('the blind review copy finds a name', async ({ page }) => {
  await page.goto('/check');
  await expect(page.locator('#uni option')).not.toHaveCount(0);
  await page.getByRole('radio', { name: 'Blind review' }).check();
  await page.getByLabel('Names').fill('Candidate Example');
  await page.locator('input[type=file]').setInputFiles(await file());
  await page.getByRole('button', { name: 'Check my thesis' }).click();
  await expect(page.getByText('Filled-in identity fields remain on the cover.')).toBeVisible();
});

// ---------- Phase P2: Word Check in the browser ----------

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
async function withFigures(megabytes: number) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await buildSyntheticThesis());
  const noise = Buffer.alloc(megabytes * 1_000_000);
  for (let i = 0; i < noise.length; i += 4) noise.writeUInt32LE((i * 2654435761) >>> 0, i); // does not compress
  zip.file('word/media/figure1.png', noise);
  return Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'STORE' }));
}

test('a thesis far above 4 MB is checked in the browser, and nothing is uploaded', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (r) => { if (r.method() !== 'GET') posts.push(`${r.method()} ${r.url()}`); });
  const big = await withFigures(20);
  expect(big.length).toBeGreaterThan(20_000_000);
  await page.goto('/check');
  await expect(page.locator('#uni option')).not.toHaveCount(0);
  await expect(page.getByText('never uploaded', { exact: false })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({ name: 'thesis-with-figures.docx', mimeType: DOCX, buffer: big });
  await page.getByRole('button', { name: 'Check my thesis' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /to fix$|Nothing to fix/ }).first()).toBeVisible();
  await expect(page.getByText(/Read from a 2\d\.\d MB file: [\d,]+ words in [\d,]+ paragraphs/)).toBeVisible();
  await expect(page.getByText('nothing was uploaded', { exact: false })).toBeVisible();
  await expect(page.getByText('Done')).toHaveCount(3);
  await expect(page.getByText(/Chapters found \(\d+\)/)).toBeVisible();
  expect(posts).toEqual([]);
});

test('the report for a large file is the same as for the same thesis without figures', async ({ page }) => {
  const headline = async (buffer: Buffer) => {
    await page.goto('/check');
    await expect(page.locator('#uni option')).not.toHaveCount(0);
    await page.locator('input[type=file]').setInputFiles({ name: 'thesis.docx', mimeType: DOCX, buffer });
    await page.getByRole('button', { name: 'Check my thesis' }).click();
    await expect(page.getByRole('heading', { level: 2, name: /to fix$|Nothing to fix/ }).first()).toBeVisible();
    return page.locator('.tally').innerText();
  };
  expect(await headline(await withFigures(8))).toBe(await headline(Buffer.from(await buildSyntheticThesis())));
});

test('damaged, empty and non-Word files are explained, and the check can be tried again', async ({ page }) => {
  await page.goto('/check');
  await expect(page.locator('#uni option')).not.toHaveCount(0);
  const good = Buffer.from(await buildSyntheticThesis());
  await page.locator('input[type=file]').setInputFiles({ name: 'damaged.docx', mimeType: DOCX, buffer: good.subarray(0, 3000) });
  await page.getByRole('button', { name: 'Check my thesis' }).click();
  await expect(page.getByText("We couldn't open this document.", { exact: false })).toBeVisible();
  await expect(page.getByText('Failed')).toBeVisible();
  // The same file can be tried again without choosing it again.
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText("We couldn't open this document.", { exact: false })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({ name: 'old.docx', mimeType: DOCX, buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]) });
  await page.getByRole('button', { name: 'Check my thesis' }).click();
  await expect(page.getByText("We couldn't open this document.", { exact: false })).toBeVisible();
  // An empty Word document says so.
  const { default: JSZip } = await import('jszip');
  const empty = await JSZip.loadAsync(good);
  empty.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/><w:sectPr/></w:body></w:document>');
  await page.locator('input[type=file]').setInputFiles({ name: 'empty.docx', mimeType: DOCX, buffer: Buffer.from(await empty.generateAsync({ type: 'uint8array' })) });
  await page.getByRole('button', { name: 'Check my thesis' }).click();
  await expect(page.getByText('This Word file has no text Supervisor can read.', { exact: false })).toBeVisible();
  // The thesis saved again correctly is checked.
  await page.locator('input[type=file]').setInputFiles({ name: 'fixed.docx', mimeType: DOCX, buffer: good });
  await page.getByRole('button', { name: 'Check my thesis' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /to fix$|Nothing to fix/ }).first()).toBeVisible();
});

test('if the university profiles cannot load, the student can load them again', async ({ page }) => {
  let fail = true;
  await page.route('**/api/profiles', (r) => (fail ? r.abort('internetdisconnected') : r.fallback()));
  await page.goto('/check');
  await expect(page.getByText('University profiles could not load.', { exact: false })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Load the university profiles again' }).click();
  await expect(page.locator('#uni option')).not.toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles({ name: 'thesis.docx', mimeType: DOCX, buffer: Buffer.from(await buildSyntheticThesis()) });
  await page.getByRole('button', { name: 'Check my thesis' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /to fix$|Nothing to fix/ }).first()).toBeVisible();
});

test('Word Check on a 390 px phone', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/check');
  await expect(page.locator('#uni option')).not.toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles({ name: 'thesis.docx', mimeType: DOCX, buffer: await withFigures(6) });
  await page.getByRole('button', { name: 'Check my thesis' }).tap();
  await expect(page.getByRole('heading', { level: 2, name: /to fix$|Nothing to fix/ }).first()).toBeVisible();
  await expect(page.getByText('nothing was uploaded', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await ctx.close();
});
