import type { McpOAuthConfig } from '@zclaudia/shared/core/mcp';

interface OAuthMetadata {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  device_authorization_endpoint?: unknown;
  scopes_supported?: unknown;
}

function validUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function discoveryUrls(config: McpOAuthConfig, resourceUrl?: string): string[] {
  const urls: string[] = [];
  const configured = validUrl(config.metadataUrl);
  if (configured) urls.push(configured);

  if (resourceUrl) {
    try {
      const origin = new URL(resourceUrl).origin;
      urls.push(`${origin}/.well-known/oauth-authorization-server`);
      urls.push(`${origin}/.well-known/openid-configuration`);
    } catch {
      // Invalid resource URLs are handled by transport setup; discovery simply skips fallback URLs.
    }
  }

  return [...new Set(urls)];
}

function mergeMetadata(config: McpOAuthConfig, metadata: OAuthMetadata): McpOAuthConfig {
  const scopes = Array.isArray(metadata.scopes_supported)
    ? metadata.scopes_supported.filter((scope): scope is string => typeof scope === 'string' && !!scope.trim())
    : undefined;

  return {
    ...config,
    authorizationEndpoint: config.authorizationEndpoint ?? validUrl(metadata.authorization_endpoint),
    tokenEndpoint: config.tokenEndpoint ?? validUrl(metadata.token_endpoint),
    deviceAuthorizationEndpoint: config.deviceAuthorizationEndpoint ?? validUrl(metadata.device_authorization_endpoint),
    scopes: config.scopes ?? (scopes && scopes.length > 0 ? scopes : undefined),
  };
}

export async function discoverMcpOAuthConfig(
  config: McpOAuthConfig,
  resourceUrl: string | undefined,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<McpOAuthConfig> {
  const urls = discoveryUrls(config, resourceUrl);
  if (urls.length === 0) return config;

  let lastError: unknown;
  for (const url of urls) {
    try {
      const response = await fetchFn(url, { method: 'GET' });
      if (!response.ok) {
        lastError = new Error(await response.text());
        continue;
      }
      const metadata = await response.json() as OAuthMetadata;
      return mergeMetadata(config, metadata);
    } catch (error) {
      lastError = error;
    }
  }

  if (config.metadataUrl) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`OAuth metadata discovery failed: ${message}`);
  }
  return config;
}
