import { describe, it, expect } from 'vitest';
import { detectSandboxDenial } from '../sandbox-denial.js';

const ALLOWED = new Set<string>(['github.com', 'registry.npmjs.org']);

describe('detectSandboxDenial', () => {
  it('returns the un-allowed host for a curl connect failure', () => {
    const out = 'curl: (7) Failed to connect to evil.example.com port 443';
    expect(detectSandboxDenial('curl https://evil.example.com/x', out, ALLOWED))
      .toEqual({ hosts: ['evil.example.com'] });
  });

  it('returns null when the failing host is already allowed', () => {
    const out = 'curl: (28) Connection timed out after 5004 milliseconds';
    expect(detectSandboxDenial('curl https://api.github.com/repos', out, new Set(['github.com'])))
      .toBeNull();
  });

  it('returns null when stderr shows no network failure signature', () => {
    expect(detectSandboxDenial('curl https://evil.example.com', 'fatal: not a git repository', ALLOWED))
      .toBeNull();
  });

  it('collects all un-allowed hosts from a compound command', () => {
    const out = 'curl: (6) Could not resolve host: a.example.com';
    const result = detectSandboxDenial('curl https://a.example.com && curl https://b.example.com', out, ALLOWED);
    expect(result).toEqual({ hosts: ['a.example.com', 'b.example.com'] });
  });

  it('treats subdomains of an allowed domain as allowed', () => {
    const out = 'curl: (28) Connection timed out';
    expect(detectSandboxDenial('curl https://codeload.github.com/x.tgz', out, new Set(['github.com'])))
      .toBeNull();
  });

  it('strips port and userinfo from extracted hosts', () => {
    const out = 'curl: (7) Failed to connect';
    expect(detectSandboxDenial('curl https://user:pw@evil.example.com:8443/x', out, ALLOWED))
      .toEqual({ hosts: ['evil.example.com'] });
  });
});
