/**
 * Network guard — blocks requests to private/internal addresses (SSRF protection).
 */

import { lookup } from 'dns/promises';
import { isIP } from 'net';

import { isPrivateOrReservedIp } from '../../../utils/ip-guard.js';

/**
 * Check if a hostname is a private/internal address that should be blocked.
 * Covers RFC 1918, RFC 4193, loopback, link-local, CGNAT, multicast, and
 * IPv4-mapped/compatible IPv6 forms (see utils/ip-guard.ts). Non-IP strings
 * (ordinary hostnames) are never blocked here — `fdn.fr` is not a ULA
 * address — they must go through DNS resolution in `isBlockedHostname`.
 */
export function isPrivateAddress(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  return isPrivateOrReservedIp(hostname);
}

/**
 * Resolve a hostname and block it if any resolved address is private/internal.
 * Fails closed: a hostname that cannot be resolved/verified is blocked.
 */
export async function isBlockedHostname(hostname: string): Promise<boolean> {
  if (isPrivateAddress(hostname)) return true;

  // Literal IPs that passed the blocklist need no DNS verification.
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare) !== 0) return false;

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.some(addr => isPrivateOrReservedIp(addr.address));
  } catch {
    // Fail closed: DNS errors previously allowed the request through,
    // leaving the guard blind exactly when resolution was interfered with.
    return true;
  }
}
