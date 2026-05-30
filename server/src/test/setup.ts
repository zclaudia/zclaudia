import { vi, beforeEach, afterEach } from 'vitest';

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
