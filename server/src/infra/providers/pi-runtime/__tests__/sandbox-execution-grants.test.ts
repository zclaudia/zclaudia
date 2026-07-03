import { describe, expect, it } from 'vitest';
import {
  extractNetworkGrantCandidates,
  formatNetworkGrantKey,
  networkGrantToAllowedDomain,
  normalizeNetworkGrant,
} from '../sandbox-execution/index.js';

describe('sandbox-execution grants', () => {
  it('extracts localhost targets with protocol and port from Bash commands', () => {
    expect(
      extractNetworkGrantCandidates('curl -s http://127.0.0.1:8000/health && echo done')
    ).toEqual([
      { type: 'network', protocol: 'http', host: '127.0.0.1', port: 8000 },
    ]);
  });

  it('extracts fetch targets from Eval code', () => {
    expect(
      extractNetworkGrantCandidates("await fetch('https://api.example.com/v1/items')")
    ).toEqual([{ type: 'network', protocol: 'https', host: 'api.example.com' }]);
  });

  it('normalizes host case, trailing dots, credentials, and ports', () => {
    expect(normalizeNetworkGrant('https://user:pw@API.Example.COM.:8443/path')).toEqual({
      type: 'network',
      protocol: 'https',
      host: 'api.example.com',
      port: 8443,
    });
  });

  it('formats stable keys including known ports', () => {
    expect(
      formatNetworkGrantKey({ type: 'network', protocol: 'http', host: '127.0.0.1', port: 8000 })
    ).toBe('network:http://127.0.0.1:8000');
    expect(formatNetworkGrantKey({ type: 'network', host: 'github.com' })).toBe(
      'network:*://github.com'
    );
  });

  it('converts structured grants to the sandbox runtime domain granularity', () => {
    expect(
      networkGrantToAllowedDomain({
        type: 'network',
        protocol: 'http',
        host: '127.0.0.1',
        port: 8000,
      })
    ).toBe('127.0.0.1');
  });
});
