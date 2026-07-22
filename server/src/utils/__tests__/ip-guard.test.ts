import { describe, expect, it } from 'vitest';

import { isPrivateOrReservedIp } from '../ip-guard.js';

describe('utils/ip-guard', () => {
  it('blocks private, loopback, and link-local IPv4', () => {
    expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('127.0.0.53')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true); // cloud metadata
    expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('172.31.255.255')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true);
    expect(isPrivateOrReservedIp('0.0.0.0')).toBe(true);
    expect(isPrivateOrReservedIp('0.1.2.3')).toBe(true);
  });

  it('blocks additional special-use IPv4 ranges', () => {
    expect(isPrivateOrReservedIp('100.64.0.1')).toBe(true); // CGNAT start
    expect(isPrivateOrReservedIp('100.127.255.254')).toBe(true); // CGNAT end
    expect(isPrivateOrReservedIp('192.0.0.8')).toBe(true); // IETF protocol assignments
    expect(isPrivateOrReservedIp('198.18.0.23')).toBe(true); // benchmarking
    expect(isPrivateOrReservedIp('198.19.255.255')).toBe(true); // benchmarking
    expect(isPrivateOrReservedIp('224.0.0.1')).toBe(true); // multicast
    expect(isPrivateOrReservedIp('239.255.255.255')).toBe(true); // multicast
    expect(isPrivateOrReservedIp('240.0.0.1')).toBe(true); // reserved
    expect(isPrivateOrReservedIp('255.255.255.255')).toBe(true); // broadcast
  });

  it('keeps boundary and documentation IPv4 addresses public', () => {
    expect(isPrivateOrReservedIp('172.32.0.1')).toBe(false);
    expect(isPrivateOrReservedIp('100.63.255.255')).toBe(false);
    expect(isPrivateOrReservedIp('100.128.0.1')).toBe(false);
    expect(isPrivateOrReservedIp('192.0.1.1')).toBe(false);
    expect(isPrivateOrReservedIp('198.17.255.255')).toBe(false);
    expect(isPrivateOrReservedIp('198.20.0.1')).toBe(false);
    expect(isPrivateOrReservedIp('223.255.255.255')).toBe(false);
    expect(isPrivateOrReservedIp('192.0.2.1')).toBe(false); // TEST-NET-1 (documentation)
    expect(isPrivateOrReservedIp('198.51.100.1')).toBe(false); // TEST-NET-2 (documentation)
    expect(isPrivateOrReservedIp('203.0.113.1')).toBe(false); // TEST-NET-3 (documentation)
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('93.184.216.34')).toBe(false);
  });

  it('blocks loopback, unspecified, ULA, link-local, and multicast IPv6', () => {
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('::')).toBe(true);
    expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
    expect(isPrivateOrReservedIp('fd12::1')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
    expect(isPrivateOrReservedIp('febf::1')).toBe(true); // fe80::/10 upper edge
    expect(isPrivateOrReservedIp('ff02::1')).toBe(true); // multicast
    expect(isPrivateOrReservedIp('[::1]')).toBe(true); // URL-style brackets
  });

  it('blocks IPv4-mapped IPv6 in dotted and hex-tail forms', () => {
    expect(isPrivateOrReservedIp('::ffff:169.254.169.254')).toBe(true); // cloud metadata
    expect(isPrivateOrReservedIp('::ffff:a9fe:a9fe')).toBe(true); // same, hex tail
    expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:7f00:1')).toBe(true); // same, hex tail
    expect(isPrivateOrReservedIp('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:0.0.0.0')).toBe(true);
    expect(isPrivateOrReservedIp('::ffff:100.64.0.1')).toBe(true); // CGNAT
    expect(isPrivateOrReservedIp('::ffff:224.0.0.1')).toBe(true); // multicast
    expect(isPrivateOrReservedIp('::ffff:198.18.0.1')).toBe(true); // benchmarking
    expect(isPrivateOrReservedIp('0:0:0:0:0:ffff:7f00:0001')).toBe(true); // full form
    expect(isPrivateOrReservedIp('0:0:0:0:0:ffff:0808:0808')).toBe(false); // mapped 8.8.8.8
    expect(isPrivateOrReservedIp('::ffff:8.8.8.8')).toBe(false); // mapped public stays public
    expect(isPrivateOrReservedIp('[::ffff:10.0.0.8]')).toBe(true); // bracketed
  });

  it('blocks deprecated IPv4-compatible IPv6 forms for private embeds', () => {
    expect(isPrivateOrReservedIp('::127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::10.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('::8.8.8.8')).toBe(false);
  });

  it('keeps public IPv6 addresses allowed', () => {
    expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateOrReservedIp('2001:4860:4860::8888')).toBe(false);
    expect(isPrivateOrReservedIp('2001:db8::1')).toBe(false); // documentation range
  });

  it('returns false for non-IP strings, including fc/fd hostnames', () => {
    expect(isPrivateOrReservedIp('fdn.fr')).toBe(false);
    expect(isPrivateOrReservedIp('fc2.com')).toBe(false);
    expect(isPrivateOrReservedIp('fd.io')).toBe(false);
    expect(isPrivateOrReservedIp('example.com')).toBe(false);
    expect(isPrivateOrReservedIp('')).toBe(false);
  });
});
