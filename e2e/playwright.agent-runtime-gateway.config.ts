import { defineConfig } from '@playwright/test';
import config from './playwright.agent-runtimes.config';

export default defineConfig({
  ...config,
  testDir: './tests/agent-runtime-gateway',
  timeout: 90_000,
  use: { ...config.use, actionTimeout: 15_000 },
  metadata: { acceptanceMode: 'gateway-v3-with-cli-fixtures' },
});
