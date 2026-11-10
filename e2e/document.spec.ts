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

// ---------- Phase P1: Word export ----------

const readDocx = async (path: string) => {
  const { default: JSZip } = await import('jszip');
  const { readFileSync } = await import('fs');
  const zip = await JSZip.loadAsync(readFileSync(path));
  return zip.file('word/document.xml')!.async('string');
};

for (const structure of ['classic', 'studies', 'system'] as const) {
  test(`Download Word gives an editable .docx with every part in order (${structure})`, async ({ page }) => {
    await seed(page, { 'path:v1': started({ title: 'Étude des lanternes & <réseaux>', structure, parts: { introduction: '## Contexte\nPremier paragraphe « écrit » par l’étudiant.\n中文 😀', conclusion: 'Final words.' } }) });
    await page.goto('/document');
    const before = await stored(page, 'path:v1');
    const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
    expect(d.suggestedFilename()).toMatch(/^thesis-etude-des-lanternes-reseaux-\d{4}-\d{2}-\d{2}\.docx$/);
    const xml = await readDocx((await d.path())!);
    const headings = [...xml.matchAll(/<w:pStyle w:val="Heading1"\/>(?:<w:pageBreakBefore\/>)?<\/w:pPr><w:r><w:t xml:space="preserve">([^<]*)</g)].map((m) => m[1]);
    const titles = await page.locator('.item h3 > span:first-child').allInnerTexts();
    expect(headings).toEqual(titles.map((t) => t.replace(/^\d+\.\s*/, '')));
    expect(xml).toContain('Premier paragraphe « écrit » par l’étudiant.');
    expect(xml).toContain('中文 😀');
    expect(xml).toContain('Étude des lanternes &amp; &lt;réseaux&gt;');
    expect(xml).toContain('Not written yet in Supervisor.');
    expect(await stored(page, 'path:v1')).toEqual(before); // nothing changed in the student's data
  });
}

test('Download Word works on a phone', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.addInitScript((p) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('path:v1', JSON.stringify(p)); sessionStorage.setItem('seeded', '1'); } }, started({ parts: { abstract: 'Short abstract.' } }));
  await page.goto('/document');
  const button = page.getByRole('button', { name: 'Download Word' });
  await expect(button).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  const [d] = await Promise.all([page.waitForEvent('download'), button.tap()]);
  expect(await readDocx((await d.path())!)).toContain('Short abstract.');
  await ctx.close();
});
