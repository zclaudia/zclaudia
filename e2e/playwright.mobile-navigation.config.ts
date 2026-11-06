import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export default defineConfig({
  testDir: './tests',
  testMatch: 'mobile-navigation.playwright.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: '../artifacts/mobile-navigation',
  reporter: [['list']],
  use: {
    browserName: 'chromium', viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync(systemChrome) ? systemChrome : undefined),
    },
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
});
