import { defineConfig } from '@playwright/test';

// No server or backend is needed. The fixture bundles the real chat components
// and loads CSS from `pnpm --filter @zclaudia/desktop build`.
export default defineConfig({
  testDir: './tests',
  testMatch: 'chat-performance.playwright.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: '../artifacts/chat-performance',
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
  ],
});
