import type Database from 'better-sqlite3';
import type {
  McpOAuthConfig,
  McpOAuthCredentials,
  McpServerTransport,
} from '@zclaudia/shared/core/mcp';
import {
  normalizeMcpHeaders,
  normalizeMcpHeadersHelper,
  normalizeMcpOAuthConfig,
  normalizeMcpServerTransport,
} from '@zclaudia/shared/core/mcp';
import { unprotectMcpOAuthCredentials } from '../infra/services/mcp-oauth-credential-protector.js';

export interface McpStdioServerConfig {
  type?: 'stdio';
  transport?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpRemoteServerConfig {
  transport: Exclude<McpServerTransport, 'stdio'>;
  command: string;
  url: string;
  headers?: Record<string, string>;
  headersHelper?: string;
  oauthConfig?: McpOAuthConfig;
  oauthCredentials?: McpOAuthCredentials;
  onOAuthCredentials?: (credentials: McpOAuthCredentials | null) => void | Promise<void>;
}

export type McpServerRuntimeConfig = McpStdioServerConfig | McpRemoteServerConfig;

interface McpServerRow {
  name: string;
  command: string;
  args: string | null;
  env: string | null;
  provider_scope: string | null;
  transport?: string | null;
  url?: string | null;
  headers?: string | null;
  headers_helper?: string | null;
  oauth_config?: string | null;
  oauth_credentials?: string | null;
}

/**
 * Load enabled MCP servers from Claudia's DB, optionally filtered by provider type.
 */
export function loadMcpServersFromDb(
  db: Database.Database,
  providerType?: string
): Record<string, McpServerRuntimeConfig> {
  const rows = db
    .prepare(
      `SELECT name, command, args, env, provider_scope,
            transport, url, headers, headers_helper, oauth_config, oauth_credentials
     FROM mcp_servers WHERE enabled = 1`
    )
    .all() as McpServerRow[];

  const servers: Record<string, McpServerRuntimeConfig> = {};
  for (const row of rows) {
    // Filter by provider scope if specified
    if (providerType && row.provider_scope) {
      try {
        const scope = JSON.parse(row.provider_scope) as string[];
        if (!scope.includes(providerType)) continue;
      } catch {
        // Invalid JSON scope — skip filtering, include the server
      }
    }

    const transport = normalizeMcpServerTransport(row.transport);
    if (transport === 'streamable-http' || transport === 'sse') {
      if (!row.url) continue;
      servers[row.name] = {
        transport,
        command: row.command,
        url: row.url,
        ...(row.headers && { headers: normalizeMcpHeaders(JSON.parse(row.headers)) }),
        ...(normalizeMcpHeadersHelper(row.headers_helper) && {
          headersHelper: normalizeMcpHeadersHelper(row.headers_helper),
        }),
        ...(row.oauth_config && {
          oauthConfig: normalizeMcpOAuthConfig(JSON.parse(row.oauth_config)),
        }),
        ...(row.oauth_credentials && {
          oauthCredentials: unprotectMcpOAuthCredentials(row.oauth_credentials),
        }),
      };
    } else {
      servers[row.name] = {
        command: row.command,
        transport: 'stdio',
        ...(row.args && { args: JSON.parse(row.args) as string[] }),
        ...(row.env && { env: JSON.parse(row.env) as Record<string, string> }),
      };
    }
  }

  if (Object.keys(servers).length > 0) {
    console.log(
      `[MCP Config] Loaded ${Object.keys(servers).length} MCP server(s) from DB` +
        (providerType ? ` for ${providerType}` : '') +
        `: ${Object.keys(servers).join(', ')}`
    );
  }

  return servers;
}
