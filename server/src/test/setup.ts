import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi, beforeEach, afterEach, afterAll } from 'vitest';

// Point every data-dir consumer at a throwaway directory before any test
// module (and its import-time singletons, e.g. the plugin permissionManager)
// loads, so tests can never rewrite the developer's real ~/.zclaudia data.
// Tests that need a specific data dir still set ZCLAUDIA_DATA_DIR themselves.
const testDataDir = mkdtempSync(join(tmpdir(), 'zclaudia-test-data-'));
process.env.ZCLAUDIA_DATA_DIR = testDataDir;
// An existing (empty) permission store keeps PermissionManager from seeding
// itself out of the legacy ~/.claudia store, so tests never read it either.
writeFileSync(join(testDataDir, 'plugin-permissions.json'), '{}');

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
