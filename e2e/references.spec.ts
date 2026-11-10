import type { Page } from '@playwright/test';
import { expect, seed, started, stored, test } from './fixtures';

// Phase P6: reference library on the Document page. Synthetic references; Crossref is mocked (the guard blocks the network).
const lib = (page: Page) => page.getByLabel('Reference library');
const refs = async (page: Page) => ((await stored(page, 'path:v1'))?.library?.refs ?? []) as { key: string; source: string; title: string; edited?: boolean }[];
const CROSSREF = { type: 'article', title: 'A lantern method for fictional networks', authors: [{ family: 'Smith', given: 'John' }], year: '2024', container: 'Journal of Lanterns', volume: '12', issue: '3', pages: '45–67', doi: '10.1234/lantern' };
const typedRefs = '[1] Fiction A. A lantern method[J]. Journal of Lanterns, 2024, 12(3): 45-67. DOI: 10.1234/lantern.\n[2] 王小明. 灯笼方法研究[D]. 南京, 2025.';
const readDocx = async (path: string) => {
  const JSZip = (await import('jszip')).default;
  const { readFileSync } = await import('fs');
  return (await JSZip.loadAsync(readFileSync(path))).file('word/document.xml')!.async('string');
};

async function addByHand(page: Page, f: { authors: string; title: string; year?: string; container?: string; type?: string }) {
  await lib(page).getByRole('button', { name: 'Add a reference by hand' }).click();
  if (f.type) await page.getByLabel('Type', { exact: true }).selectOption(f.type);
  await page.getByLabel('Authors').fill(f.authors);
  await page.getByLabel('Title', { exact: true }).fill(f.title);
  if (f.year) await page.getByLabel('Year').fill(f.year);
  if (f.container) await page.getByLabel(/^(Journal|Book or proceedings)$/).fill(f.container);
  await page.getByRole('button', { name: 'Add to library' }).click();
}

test('manual references in English and Chinese, incomplete ones flagged, duplicates caught', async ({ page }) => {
  await seed(page, { 'path:v1': started({ parts: { references: typedRefs } }) });
  await page.goto('/document');
  await addByHand(page, { authors: 'Brown, Ana', title: 'Fictional deep learning', type: 'book' });
  await addByHand(page, { authors: '王小明; 李华', title: '灯笼方法在虚构网络中的应用', year: '2025', container: '虚构计算机学报' });
  const items = lib(page).getByTestId('lib-ref');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Entered by you');
  await expect(items.nth(0)).toContainText('Incomplete: publisher, year');
  await expect(items.nth(1)).toContainText('[@王小明2025]');
  await expect(items.nth(1)).toContainText('王小明, & 李华. (2025). 灯笼方法在虚构网络中的应用. 虚构计算机学报.');
  // The same reference again is caught before it is saved.
  await addByHand(page, { authors: '王小明; 李华', title: '灯笼方法在虚构网络中的应用', year: '2025', container: '虚构计算机学报' });
  await expect(page.getByText('This looks like a reference already in your library: [@王小明2025]')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await refs(page)).toHaveLength(2);
  // Typed references are untouched.
  expect((await stored(page, 'path:v1')).parts.references).toBe(typedRefs);
});

test('DOI lookup adds a verified record; invalid DOI and network failure are explained', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  let sent = '';
  let calls = 0;
  await page.route('**/api/references/lookup', async (r) => {
    calls++;
    sent = r.request().postData() ?? '';
    const b = JSON.parse(sent);
    if (b.doi === 'lantern') return r.fulfill({ status: 400, json: { error: 'This is not a valid DOI. A DOI starts with 10., followed by a slash, for example 10.1000/xyz123.', code: 'invalid_doi', retryable: false } });
    if (b.doi === '10.9999/down') return r.abort('connectionfailed');
    return r.fulfill({ json: { candidates: [CROSSREF] } });
  });
  await page.goto('/document');
  await page.getByLabel('DOI', { exact: true }).fill('lantern');
  await lib(page).getByRole('button', { name: 'Search' }).click();
  await expect(lib(page).getByRole('alert')).toContainText('This is not a valid DOI.');
  await page.getByLabel('DOI', { exact: true }).fill('10.9999/down');
  await lib(page).getByRole('button', { name: 'Search' }).click();
  await expect(lib(page).getByRole('alert')).toContainText("We couldn't reach Supervisor.");
  await expect(lib(page).getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.getByLabel('DOI', { exact: true }).fill('10.1234/lantern');
  await lib(page).getByRole('button', { name: 'Search' }).click();
  // Only the DOI is sent: no thesis text.
  expect(JSON.parse(sent)).toEqual({ doi: '10.1234/lantern' });
  await lib(page).getByRole('button', { name: 'Add to library' }).click();
  await expect(lib(page).getByTestId('lib-ref')).toContainText('Verified with Crossref');
  await lib(page).getByRole('button', { name: 'Search' }).click();
  await expect(lib(page).getByText('Already in your library as [@smith2024]')).toBeVisible();
  const [r] = await refs(page);
  expect(r).toMatchObject({ key: 'smith2024', source: 'crossref' });
  // Editing a Crossref record is shown as such.
  await lib(page).getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Pages').fill('45–68');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(lib(page).getByTestId('lib-ref')).toContainText('From Crossref, edited by you');
  expect(calls).toBeGreaterThanOrEqual(4);
});

test('BibTeX import adds new entries and lists those already in the library', async ({ page }) => {
  await seed(page, { 'path:v1': started() });
  await page.goto('/document');
  await lib(page).getByText('Import BibTeX').click();
  const bib = '@article{smith2024, author = {Smith, John}, title = {A lantern method}, journal = {Journal of Lanterns}, year = {2024}, doi = {10.1234/lantern}}\n@book{wang2025, author = {王小明}, title = {灯笼方法}, publisher = {虚构出版社}, year = {2025}}';
  await page.getByLabel('BibTeX entries').fill(bib);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('2 added.')).toBeVisible();
  await page.getByLabel('BibTeX entries').fill(bib);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('0 added. 2 already in your library, not added again')).toBeVisible();
  expect((await refs(page)).map((r) => [r.key, r.source])).toEqual([['smith2024', 'bibtex'], ['wang2025', 'bibtex']]);
});

for (const [style, inText, entry] of [
  ['apa7', 'Lanterns help. (Smith, 2024)', 'Smith, J. (2024). '],
  ['gbt7714', 'Lanterns help. [1]', '[1] SMITH J. A lantern method[J]. Journal of Lanterns, 2024.'],
] as const) {
  test(`a citation inserted in the text and the reference list agree in the Word file (${style})`, async ({ page }) => {
    const library = { style, refs: [{ id: 'r1', key: 'smith2024', type: 'article', title: 'A lantern method', authors: [{ family: 'Smith', given: 'John' }], year: '2024', container: 'Journal of Lanterns', source: 'manual', createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z' }] };
    await seed(page, { 'path:v1': started({ library: library as never, parts: { introduction: 'Lanterns help.', references: '[9] A reference typed by hand.' } }) });
    await page.goto('/document');
    await page.getByRole('button', { name: 'Continue writing' }).first().click(); // Introduction, the only part with text
    const box = page.locator('#part-introduction');
    await box.focus();
    await box.press('End');
    await page.getByLabel('Insert a citation').selectOption('smith2024');
    await expect(box).toHaveValue('Lanterns help. [@smith2024]');
    const before = await stored(page, 'path:v1');
    expect(before.parts.references).toBe('[9] A reference typed by hand.');
    await expect(page.getByLabel('What the Word file holds')).toContainText('2 reference entries');
    const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
    const xml = await readDocx((await d.path())!);
    expect(xml.replace(/<[^>]+>/g, '')).toContain(inText);
    if (style === 'gbt7714') expect(xml).toContain('<w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">[1]</w:t>');
    expect(xml.replace(/<[^>]+>/g, '')).toContain(entry);
    expect(xml).toContain('[9] A reference typed by hand.');
    expect(await stored(page, 'path:v1')).toEqual(before); // the export changes nothing
  });
}

test('deleting a cited reference asks first and warns that its citations will be missing', async ({ page }) => {
  const library = { refs: [{ id: 'r1', key: 'smith2024', type: 'article', title: 'A lantern method', authors: [{ family: 'Smith' }], year: '2024', container: 'J', source: 'manual', createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z' }] };
  await seed(page, { 'path:v1': started({ library: library as never, parts: { introduction: 'See [@smith2024].' } }) });
  await page.goto('/document');
  await lib(page).getByRole('button', { name: 'Delete [@smith2024]' }).click();
  await expect(lib(page).getByText('It is cited 1× in your text; those citations will show as missing.')).toBeVisible();
  await lib(page).getByRole('button', { name: 'Delete for good' }).click();
  const p = await stored(page, 'path:v1');
  expect(p.library.refs).toEqual([]);
  expect(p.parts.introduction).toBe('See [@smith2024].'); // the text is never changed
});

test('the lookup route checks the DOI before any request leaves the server', async ({ request }) => {
  const r = await request.post('/api/references/lookup', { data: { doi: 'not-a-doi' } });
  expect(r.status()).toBe(400);
  expect((await r.json()).code).toBe('invalid_doi');
  expect((await request.post('/api/references/lookup', { data: { query: 'x' } })).status()).toBe(400);
});

test.describe('on a 390px screen', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('the library fits without side scrolling', async ({ page }) => {
    await seed(page, { 'path:v1': started({ parts: { references: typedRefs } }) });
    await page.goto('/document');
    await lib(page).getByRole('button', { name: 'Add a reference by hand' }).click();
    await lib(page).getByText('Import BibTeX').click();
    await page.getByText('References you typed in the References part (2)').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
