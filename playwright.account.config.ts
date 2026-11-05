import { defineConfig, devices } from '@playwright/test';

const PORT = 3201;
const AUTH_PORT = 4120;

// A local stand-in for Supabase, so saving and sign-in run without touching production.
export default defineConfig({
  testDir: './e2e-account',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 45_000,
  reporter: process.env.CI ? [['github']] : [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node e2e-account/mock-supabase.mjs', port: AUTH_PORT, reuseExistingServer: false },
    {
      command: `npx next build && npx next start -p ${PORT}`,
      port: PORT,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${AUTH_PORT}`,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fake',
        LLM_BASE_URL: '',
        LLM_API_KEY: '',
        LLM_MODEL: '',
      },
    },
  ],
});
