import type { SandboxNetworkGrant } from './types.js';

const URL_RE = /\bhttps?:\/\/[^\s'"`<>),;]+/gi;

function cleanUrl(raw: string): string {
  return raw.replace(/[)\].,;]+$/g, '');
}

export function normalizeNetworkGrant(rawUrl: string): SandboxNetworkGrant | undefined {
  let url: URL;
  try {
    url = new URL(cleanUrl(rawUrl));
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host) return undefined;
  const port = url.port ? Number(url.port) : undefined;
  const validPort = port !== undefined && Number.isInteger(port) && port > 0;
  return {
    type: 'network',
    protocol: url.protocol === 'http:' ? 'http' : 'https',
    host,
    ...(validPort ? { port } : {}),
  };
}

export function extractNetworkGrantCandidates(text: string): SandboxNetworkGrant[] {
  const grants = new Map<string, SandboxNetworkGrant>();
  for (const match of text.matchAll(URL_RE)) {
    const grant = normalizeNetworkGrant(match[0]);
    if (!grant) continue;
    grants.set(formatNetworkGrantKey(grant), grant);
  }
  return [...grants.values()];
}

export function formatNetworkGrantKey(grant: SandboxNetworkGrant): string {
  const protocol = grant.protocol ?? '*';
  const port = grant.port ? `:${grant.port}` : '';
  return `network:${protocol}://${grant.host}${port}`;
}

/**
 * Reduce a structured grant to what the sandbox can actually enforce. The
 * underlying @anthropic-ai/sandbox-runtime network config accepts host-level
 * domain patterns only (`allowedDomains: string[]`, matched against the
 * canonical host — no port or protocol granularity), so approving
 * `http://host:port` necessarily opens ALL ports and protocols on that host
 * for the session. This widening is disclosed in the approval text
 * (buildSandboxCapabilityRequest in permissions.ts); do not "fix" it here by
 * inventing `host:port` strings — the runtime would reject or misparse them.
 */
export function networkGrantToAllowedDomain(grant: SandboxNetworkGrant): string {
  return grant.host;
}

export function formatGrantForDisplay(grant: SandboxNetworkGrant): string {
  const protocol = grant.protocol ?? '*';
  const port = grant.port ? `:${grant.port}` : '';
  return `${protocol}://${grant.host}${port}`;
}
