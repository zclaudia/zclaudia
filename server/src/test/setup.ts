import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi, beforeEach, afterEach, afterAll } from 'vitest';

// Point every data-dir consumer at a throwaway directory before any test
// module (and its import-time singletons, e.g. the plugin permissionManager)
// loads, so tests can never rewrite the developer's real ~/.zclaudia data.
// Tests that need a specific data dir still set ZCLAUDIA_DATA_DIR themselves.
const testDataDir = mkdtempSync(join(tmpdir(), 'zclaudia-test-data-'));
process.env.ZCLAUDIA_DATA_DIR = testDataDir;
// Legacy (~/.claudia) seeding — plugin permissions, plugin storage — reads
// from a dir that never exists, so tests never touch the real legacy data.
process.env.ZCLAUDIA_LEGACY_DATA_DIR = join(testDataDir, 'legacy-claudia-missing');

afterAll(() => {
  rmSync(testDataDir, { recursive: true, force: true });
});

// Global test setup
beforeEach(() => {
  vi.clearAllMocks();
});

// Clean up after each test
afterEach(() => {
  vi.restoreAllMocks();
});

// Mock console.error/log to reduce noise in tests
// vi.spyOn(console, 'error').mockImplementation(() => {});
// vi.spyOn(console, 'log').mockImplementation(() => {});
