import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/resource-sync',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: '../artifacts/resource-sync',
  reporter: [['list']],
  use: {
    channel: process.env.E2E_BROWSER_CHANNEL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
