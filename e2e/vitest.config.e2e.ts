import { defineConfig } from 'vitest/config';
import { config as loadEnv } from 'dotenv';

// Load .env file before vitest starts
loadEnv();

export default defineConfig({
  test: {
    include: ['e2e/tests/**/*.spec.ts'],
    pool: 'forks',
    fileParallelism: false, // Sequential execution for DB consistency
    testTimeout: 120000, // Increased for AI tests
    retry: process.env.CI ? 2 : 0,
    allowOnly: !process.env.CI,
    globalSetup: ['./e2e/setup/global-setup.ts'],
    reporters: ['default'],
    setupFiles: [
      './e2e/helpers/custom-matchers.ts',
      './e2e/helpers/ai-test-utils.ts',
    ],
    // Environment variables for AI testing
    env: {
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENAI_MODEL_NAME: process.env.OPENAI_MODEL_NAME,
    },
  },
});
