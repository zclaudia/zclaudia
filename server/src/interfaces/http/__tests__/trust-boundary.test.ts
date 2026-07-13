import { describe, expect, it } from 'vitest';
import {
  createCorsOriginGuard,
  defaultServerHost,
  isLocalServerHost,
  isRequestOriginAllowed,
} from '../trust-boundary.js';

describe('trust boundary helpers', () => {
  it('binds to localhost by default', () => {
    expect(defaultServerHost({})).toBe('127.0.0.1');
  });

  it('allows explicit LAN mode or SERVER_HOST override', () => {
    expect(defaultServerHost({ ZCLAUDIA_ALLOW_LAN: '1' })).toBe('0.0.0.0');
    expect(defaultServerHost({ SERVER_HOST: '::' })).toBe('::');
  });

  it('identifies local bind hosts', () => {
    expect(isLocalServerHost('127.0.0.1')).toBe(true);
    expect(isLocalServerHost('localhost')).toBe(true);
    expect(isLocalServerHost('::1')).toBe(true);
    expect(isLocalServerHost('0.0.0.0')).toBe(false);
    expect(isLocalServerHost('::')).toBe(false);
  });

  it('allows no-origin and local desktop origins', () => {
    expect(isRequestOriginAllowed(undefined, {})).toBe(true);
    expect(isRequestOriginAllowed('http://localhost:1420', {})).toBe(true);
    expect(isRequestOriginAllowed('http://127.0.0.1:1420', {})).toBe(true);
    expect(isRequestOriginAllowed('tauri://localhost', {})).toBe(true);
    expect(isRequestOriginAllowed('https://tauri.localhost', {})).toBe(true);
  });

  it('rejects browser origins outside the local allowlist', () => {
    expect(isRequestOriginAllowed('https://evil.example', {})).toBe(false);
  });

  it('allows explicitly configured origins but only allows wildcard in unsafe mode', () => {
    expect(
      isRequestOriginAllowed('https://ops.example', {
        ZCLAUDIA_ALLOWED_ORIGINS: 'https://ops.example',
      })
    ).toBe(true);
    expect(
      isRequestOriginAllowed('https://ops.example', {
        ZCLAUDIA_ALLOWED_ORIGINS: '*',
      })
    ).toBe(false);
    expect(
      isRequestOriginAllowed('https://ops.example', {
        ZCLAUDIA_ALLOWED_ORIGINS: '*',
        ZCLAUDIA_TRUST_MODE: 'unsafe',
      })
    ).toBe(true);
  });

  it('returns a CORS error for disallowed origins', () => {
    const guard = createCorsOriginGuard({});
    let error: Error | null = null;
    let allowed: boolean | undefined;

    guard('https://evil.example', (err, allow) => {
      error = err;
      allowed = allow;
    });

    expect(error?.message).toContain('Origin not allowed');
    expect(allowed).toBeUndefined();
  });
});
