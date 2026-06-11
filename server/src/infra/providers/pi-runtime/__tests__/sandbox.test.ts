import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import { isSandboxAvailable, SENSITIVE_DENY_READ, DEFAULT_ALLOWED_DOMAINS, __resetSandboxCacheForTests } from '../sandbox.js';

describe('sandbox availability + constants', () => {
  let prev: string | undefined;
  beforeEach(() => { prev = process.env.ZCLAUDIA_SANDBOX; __resetSandboxCacheForTests(); });
  afterEach(() => { if (prev === undefined) delete process.env.ZCLAUDIA_SANDBOX; else process.env.ZCLAUDIA_SANDBOX = prev; __resetSandboxCacheForTests(); });

  it('ZCLAUDIA_SANDBOX=off → unavailable regardless of host', () => {
    process.env.ZCLAUDIA_SANDBOX = 'off';
    expect(isSandboxAvailable()).toBe(false);
  });

  it('SENSITIVE_DENY_READ entries are absolute (no leading ~) and home-expanded', () => {
    expect(SENSITIVE_DENY_READ.length).toBeGreaterThan(0);
    for (const p of SENSITIVE_DENY_READ) {
      expect(p.startsWith('~')).toBe(false);
    }
    expect(SENSITIVE_DENY_READ.some(p => p.startsWith(os.homedir()) && p.endsWith('.ssh'))).toBe(true);
  });

  it('DEFAULT_ALLOWED_DOMAINS covers common registries + VCS', () => {
    expect(DEFAULT_ALLOWED_DOMAINS).toContain('registry.npmjs.org');
    expect(DEFAULT_ALLOWED_DOMAINS).toContain('github.com');
    expect(DEFAULT_ALLOWED_DOMAINS).toContain('pypi.org');
  });
});
