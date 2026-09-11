import { defineConfig } from '@playwright/test';
import config from './playwright.agent-runtimes.config';

// Fault injection mutates private artifact copies. Keep this distinct from
// both source tests and the immutable, source-denied bundle acceptance run.
export default defineConfig({
  ...config,
  testDir: './tests/agent-runtime-artifacts',
  timeout: 90_000,
  use: { ...config.use, actionTimeout: 15_000 },
  metadata: { acceptanceMode: 'mutable-artifact-fixtures' },
});
