import { defineConfig, devices } from '@playwright/test';

const PORT = 3200;
const MOCK_PORT = 4110;

// Empty Supabase values keep tests away from production. Client code then uses its local mode.
const appEnv = {
  NEXT_PUBLIC_SUPABASE_URL: '',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
  LLM_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  LLM_API_KEY: 'e2e-mock-key',
  LLM_MODEL: 'e2e-mock-model',
};

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node e2e/mock-ai.mjs', port: MOCK_PORT, reuseExistingServer: false, env: { MOCK_PORT: String(MOCK_PORT) } },
    { command: `npx next build && npx next start -p ${PORT}`, port: PORT, timeout: 240_000, reuseExistingServer: false, env: appEnv },
  ],
});
