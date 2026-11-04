import { expect, test as base, type Page } from '@playwright/test';
import type { PathState } from '../src/lib/path';

// Every test fails if the browser tries to reach anything except the local app.
export const test = base.extend<{ guard: void }>({
  guard: [
    async ({ context }, use) => {
      const external: string[] = [];
      await context.route('**/*', (route) => {
        const host = new URL(route.request().url()).hostname;
        if (host === '127.0.0.1') return route.fallback();
        external.push(route.request().url());
        return route.abort();
      });
      await use();
      expect(external).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const started = (over: Partial<PathState> = {}): PathState => ({
  topic: 'Fictional topic',
  discipline: 'Computer science',
  defenseDate: '',
  current: 'title',
  started: true,
  situation: 'title',
  steps: {},
  log: [],
  savedAt: '2026-11-04T10:00:00.000Z',
  ...over,
});

/** Seeds browser storage once, so a reload keeps what the app saved. */
export async function seed(page: Page, entries: Record<string, unknown>) {
  await page.addInitScript((e) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    for (const [k, v] of Object.entries(e)) localStorage.setItem(k, JSON.stringify(v));
  }, entries);
}

export const stored = (page: Page, key: string) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);
