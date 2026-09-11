import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const input = process.env.ZCLAUDIA_RUNTIME_LIVE_INPUT;
if (!input)
  throw new Error('Use test:e2e:agent-runtimes:live with explicit CLI and account options');
const options = JSON.parse(readFileSync(input, 'utf8'));
if (!options.selfTest && !options.allowLive)
  throw new Error('Live CLI execution was not explicitly enabled');
export default defineConfig({
  testDir: './tests/agent-runtime-live',
  testMatch: '**/*.playwright.spec.ts',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: options.turnTimeoutMs * options.maxTurns + 60_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(options.outputDirectory, 'test-results'),
  // Playwright also writes automatic error-context DOM snapshots even when
  // trace/screenshot/video are off. Keep only our explicit evidence artifacts.
  preserveOutput: 'never',
  metadata: {
    acceptanceMode: options.selfTest
      ? 'live-runner-with-cli-fixtures'
      : 'full-application-with-real-cli',
  },
  reporter: [
    ['./helpers/agent-runtime-reporter.ts', { artifactRoot: options.outputDirectory }],
    ...(options.selfTest ? [['list'] as ['list']] : []),
  ],
  // Protocol traces and server logs can include bearer tokens and account data.
  // Explicit, credential-free state evidence is collected by the live driver.
  use: {
    headless: options.headless,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
