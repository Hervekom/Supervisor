import { expect, seed, stored, test } from './fixtures';

test('shows sign in and create account', async ({ page }) => {
  await page.goto('/account');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible();
  await page.getByRole('button', { name: 'I have an account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
});

test('never contacts a real account service in tests', async ({ page }) => {
  await page.goto('/account');
  await page.getByLabel('Email').fill('student@example.com');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.error')).toHaveText('Accounts are not set up on this server.');
});

test('saves and removes a personal AI key in ai:v1', async ({ page }) => {
  await page.goto('/account');
  await page.getByLabel('Provider').selectOption('custom');
  await page.getByLabel('Service address').fill('https://api.example.com/v1');
  await page.getByLabel('Model name').fill('fake-model');
  await page.getByLabel('API key').fill('fake-key-123456');
  await page.getByRole('button', { name: 'Save my AI' }).click();
  expect(await stored(page, 'ai:v1')).toEqual({ provider: 'custom', baseUrl: 'https://api.example.com/v1', apiKey: 'fake-key-123456', model: 'fake-model' });

  await page.reload();
  await expect(page.getByLabel('API key')).toHaveValue('fake-key-123456');
  await page.getByRole('button', { name: 'Remove my key' }).click();
  expect(await stored(page, 'ai:v1')).toBeNull();
});

test('reads an AI setting saved by the current release', async ({ page }) => {
  await seed(page, { 'ai:v1': { provider: 'kimi', apiKey: 'fake-key-123456', model: 'fake-model' } });
  await page.goto('/account');
  await expect(page.getByLabel('Provider')).toHaveValue('kimi');
  await expect(page.getByLabel('Model name')).toHaveValue('fake-model');
});
