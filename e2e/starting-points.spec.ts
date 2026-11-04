import { SITUATIONS, STEPS } from '../src/lib/path';
import { expect, stored, test } from './fixtures';

test('offers exactly eight starting points', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('radio')).toHaveCount(8);
});

for (const s of SITUATIONS) {
  test(`starts from: ${s.label}`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('radio', { name: s.label }).check();
    if (s.field) await page.getByLabel(s.field).fill('A fictional title about lanterns');
    await page.getByRole('button', { name: 'Continue' }).click();

    const step = STEPS.find((x) => x.id === s.start)!;
    await expect(page.getByRole('heading', { level: 2, name: step.title })).toBeVisible();
    await expect(page.getByText(`Step ${STEPS.indexOf(step) + 1} of 21`)).toBeVisible();

    const path = await stored(page, 'path:v1');
    expect(path).toMatchObject({ started: true, situation: s.id, current: s.start });

    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: step.title })).toBeVisible();
  });
}
