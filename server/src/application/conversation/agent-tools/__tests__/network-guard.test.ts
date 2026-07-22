import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

describe('agent-tools/network-guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks private IPv4 and IPv4-mapped IPv6 addresses', async () => {
    const { isPrivateAddress } = await import('../network-guard.js');

    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('172.16.5.4')).toBe(true);
    expect(isPrivateAddress('172.31.255.255')).toBe(true);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('[::ffff:10.0.0.8]')).toBe(true);
    expect(isPrivateAddress('fd12::1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });

  it('blocks special-use ranges and hex/compatible IPv4-mapped forms', async () => {
    const { isPrivateAddress } = await import('../network-guard.js');

    expect(isPrivateAddress('169.254.169.254')).toBe(true); // cloud metadata
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true); // mapped metadata
    expect(isPrivateAddress('::ffff:a9fe:a9fe')).toBe(true); // hex-tail mapped metadata
    expect(isPrivateAddress('::ffff:7f00:1')).toBe(true); // hex-tail mapped loopback
    expect(isPrivateAddress('::127.0.0.1')).toBe(true); // v4-compatible loopback
    expect(isPrivateAddress('100.64.0.1')).toBe(true); // CGNAT
    expect(isPrivateAddress('224.0.0.1')).toBe(true); // multicast
    expect(isPrivateAddress('240.0.0.1')).toBe(true); // reserved
  });

  it('does not mistake legitimate fc/fd hostnames for IPv6 ULA literals', async () => {
    const dns = await import('dns/promises');
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '212.27.32.5', family: 4 }] as never);

    const { isPrivateAddress, isBlockedHostname } = await import('../network-guard.js');

    expect(isPrivateAddress('fdn.fr')).toBe(false);
    expect(isPrivateAddress('fc2.com')).toBe(false);
    expect(isPrivateAddress('fd.io')).toBe(false);
    await expect(isBlockedHostname('fdn.fr')).resolves.toBe(false);
    await expect(isBlockedHostname('fc2.com')).resolves.toBe(false);
    await expect(isBlockedHostname('fd.io')).resolves.toBe(false);
  });

  it('blocks public hostnames that resolve to private addresses', async () => {
    const dns = await import('dns/promises');
    vi.mocked(dns.lookup).mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.8', family: 4 },
    ] as never);

    const { isBlockedHostname } = await import('../network-guard.js');

    await expect(isBlockedHostname('example.com')).resolves.toBe(true);
  });

  it('fails closed when DNS resolution fails for non-literal hostnames', async () => {
    const dns = await import('dns/promises');
    vi.mocked(dns.lookup).mockRejectedValue(new Error('dns failure'));

    const { isBlockedHostname } = await import('../network-guard.js');

    // Fail closed: unverifiable hostnames are blocked, not silently allowed.
    await expect(isBlockedHostname('public.example')).resolves.toBe(true);
    await expect(isBlockedHostname('localhost')).resolves.toBe(true);
  });

  it('skips DNS verification for public IP literals', async () => {
    const dns = await import('dns/promises');

    const { isBlockedHostname } = await import('../network-guard.js');

    await expect(isBlockedHostname('8.8.8.8')).resolves.toBe(false);
    await expect(isBlockedHostname('[2606:4700:4700::1111]')).resolves.toBe(false);
    expect(dns.lookup).not.toHaveBeenCalled();
  });
});
