import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const runId =
  process.env.AGENT_RUNTIME_E2E_RUN_ID ??
  `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
process.env.AGENT_RUNTIME_E2E_RUN_ID = runId;
if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Invalid AGENT_RUNTIME_E2E_RUN_ID');
const artifactRoot = path.resolve(
  import.meta.dirname,
  '../artifacts/agent-runtime-migration',
  runId
);

export default defineConfig({
  testDir: './tests/agent-runtimes',
  testMatch: '**/*.playwright.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(artifactRoot, 'test-results'),
  reporter: [
    ['./helpers/agent-runtime-reporter.ts', { artifactRoot }],
    ['list'],
    ['html', { outputFolder: path.join(artifactRoot, 'report'), open: 'never' }],
    ['json', { outputFile: path.join(artifactRoot, 'results.json') }],
  ],
  use: {
    channel: process.env.E2E_BROWSER_CHANNEL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
