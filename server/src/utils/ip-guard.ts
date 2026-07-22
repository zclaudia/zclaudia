/**
 * Shared SSRF guard — decides whether an IP address is private, reserved, or
 * otherwise special-use and therefore unsafe as a fetch target. Used by both
 * pi-runtime web-tools and the agent-tools network-guard so every outbound
 * fetch path enforces the same blocklist.
 */

import { isIP } from 'net';

function stripBrackets(address: string): string {
  return address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
}

function isPrivateOrReservedIPv4(address: string): boolean {
  const [a, b, c] = address.split('.').map(part => Number(part));
  return (
    a === 0 || // 0.0.0.0/8 — "this network" (RFC 1122)
    a === 10 || // 10.0.0.0/8 — RFC 1918
    a === 127 || // 127.0.0.0/8 — loopback
    (a === 169 && b === 254) || // 169.254.0.0/16 — link-local (incl. cloud metadata 169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 — RFC 1918
    (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24 — IETF protocol assignments
    (a === 192 && b === 168) || // 192.168.0.0/16 — RFC 1918
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 — benchmarking (RFC 2544)
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 — CGNAT (RFC 6598)
    a >= 224 // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved (incl. 255.255.255.255)
  );
  // Deliberately NOT blocked: documentation ranges 192.0.2.0/24, 198.51.100.0/24,
  // 203.0.113.0/24 and 2001:db8::/32 — tests rely on them as harmless "public" stand-ins.
}

/**
 * Expand an IPv6 address into its eight 16-bit groups. Accepts `::`
 * compression, a dotted-quad tail (`::ffff:127.0.0.1`), and a `%zone` suffix.
 * Callers must run `isIP` first; this returns null for anything malformed.
 */
function expandIPv6Groups(address: string): number[] | null {
  let input = address.toLowerCase();

  const zoneIndex = input.indexOf('%');
  if (zoneIndex !== -1) input = input.slice(0, zoneIndex);

  const lastColon = input.lastIndexOf(':');
  const tail = input.slice(lastColon + 1);
  if (tail.includes('.')) {
    const parts = tail.split('.').map(part => Number(part));
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
      return null;
    }
    const hi = ((parts[0] << 8) | parts[1]).toString(16);
    const lo = ((parts[2] << 8) | parts[3]).toString(16);
    input = `${input.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const halves = input.split('::');
  if (halves.length > 2) return null;

  const parseGroups = (text: string): number[] =>
    text === '' ? [] : text.split(':').map(group => parseInt(group, 16));

  const head = parseGroups(halves[0]);
  const tailGroups = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (head.some(Number.isNaN) || tailGroups.some(Number.isNaN)) return null;
  if (halves.length === 1 && head.length !== 8) return null;

  const missing = 8 - head.length - tailGroups.length;
  if (missing < 0 || (halves.length === 2 && missing === 0)) return null;

  return [...head, ...new Array<number>(missing).fill(0), ...tailGroups];
}

/**
 * Return true when `address` is an IPv4/IPv6 literal in a private, reserved,
 * or special-use range. Accepts URL-style bracketed literals (`[::1]`) and
 * IPv4-mapped/compatible IPv6 forms in both dotted (`::ffff:169.254.169.254`)
 * and hex-tail (`::ffff:a9fe:a9fe`) notations. Non-IP strings return false —
 * hostname-level checks (e.g. "localhost") are the caller's job.
 */
export function isPrivateOrReservedIp(address: string): boolean {
  const bare = stripBrackets(address);
  const version = isIP(bare);

  if (version === 4) return isPrivateOrReservedIPv4(bare);
  if (version !== 6) return false;

  const groups = expandIPv6Groups(bare);
  if (!groups) return false;

  // :: (unspecified) and ::1 (loopback)
  if (groups.every(group => group === 0)) return true;
  if (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) return true;

  // IPv4-mapped ::ffff:0:0/96 — recurse into the embedded v4 checks so every
  // v4 range above (incl. 169.254.0.0/16 cloud metadata) also covers its
  // mapped form, whether written dotted or as hex tail.
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    const v4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
    return isPrivateOrReservedIPv4(v4);
  }

  // Deprecated IPv4-compatible ::/96 (e.g. ::127.0.0.1 as returned by some
  // resolvers) — :: and ::1 are already handled above.
  if (groups.slice(0, 6).every(group => group === 0)) {
    const v4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
    return isPrivateOrReservedIPv4(v4);
  }

  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 — unique-local (RFC 4193)
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 — link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 — multicast

  return false;
}
