import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoist mocks so they are available before module imports
const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

import { meetsRequirements, __resetBinaryCache } from '../skill-requirements.js';

describe('meetsRequirements', () => {
  beforeEach(() => {
    __resetBinaryCache();
    vi.restoreAllMocks();
    mockExecFileSync.mockReset();
  });

  it('returns true when requirements is undefined', () => {
    expect(meetsRequirements(undefined)).toBe(true);
  });

  it('returns true when OS matches', () => {
    expect(meetsRequirements({ os: ['darwin'] }, { os: 'darwin' })).toBe(true);
  });

  it('returns false when OS does not match', () => {
    expect(meetsRequirements({ os: ['win32'] }, { os: 'darwin' })).toBe(false);
  });

  it('normalizes OS aliases (macos → darwin)', () => {
    expect(meetsRequirements({ os: ['macos'] }, { os: 'darwin' })).toBe(true);
  });

  it('returns true when all binaries are available', () => {
    mockExecFileSync.mockReturnValue(Buffer.from(''));
    expect(meetsRequirements({ binaries: ['git', 'node'] })).toBe(true);
  });

  it('returns false when a binary is missing', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(meetsRequirements({ binaries: ['nonexistent-binary'] })).toBe(false);
  });

  it('returns true when env vars are present', () => {
    process.env.SKILL_TEST_VAR = 'set';
    expect(meetsRequirements({ env: ['SKILL_TEST_VAR'] })).toBe(true);
    delete process.env.SKILL_TEST_VAR;
  });

  it('returns false when env var is missing', () => {
    delete process.env.SKILL_TEST_MISSING;
    expect(meetsRequirements({ env: ['SKILL_TEST_MISSING'] })).toBe(false);
  });
});
