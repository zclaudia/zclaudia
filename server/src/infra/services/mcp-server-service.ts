import type Database from 'better-sqlite3';
import type {
  McpOAuthConfig,
  McpOAuthCredentials,
  McpServerConfig,
  McpServerTransport,
  McpServerTrustPolicy,
} from '@zclaudia/shared/core/mcp';
import {
  normalizeMcpHeaders,
  normalizeMcpHeadersHelper,
  normalizeMcpOAuthConfig,
  normalizeMcpServerTransport,
  normalizeMcpServerTrustPolicy,
} from '@zclaudia/shared/core/mcp';
import { newId } from '../../utils/uuid.js';
import { protectMcpOAuthCredentials, unprotectMcpOAuthCredentials } from './mcp-oauth-credential-protector.js';

export interface McpServerRow {
  id: string;
  name: string;
  command: string;
  args: string | null;
  env: string | null;
  enabled: number;
  description: string | null;
  source: string;
  provider_scope: string | null;
  trust_policy?: string | null;
  transport?: string | null;
  url?: string | null;
  headers?: string | null;
  headers_helper?: string | null;
  oauth_config?: string | null;
  oauth_credentials?: string | null;
  created_at: number;
  updated_at: number;
}

interface CreateMcpServerInput {
  name?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: McpServerTransport;
  url?: string;
  headers?: Record<string, string>;
  headersHelper?: string;
  oauthConfig?: McpOAuthConfig;
  oauthCredentials?: McpOAuthCredentials;
  enabled?: boolean;
  description?: string;
  providerScope?: string[];
  trustPolicy?: McpServerTrustPolicy;
}

interface UpdateMcpServerInput {
  name?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: McpServerTransport;
  url?: string | null;
  headers?: Record<string, string> | null;
  headersHelper?: string | null;
  oauthConfig?: McpOAuthConfig | null;
  oauthCredentials?: McpOAuthCredentials | null;
  enabled?: boolean;
  description?: string | null;
  providerScope?: string[] | null;
  trustPolicy?: McpServerTrustPolicy | null;
}

export class McpServerServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function rowToConfig(row: McpServerRow): McpServerConfig {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    args: row.args ? JSON.parse(row.args) : undefined,
    env: row.env ? JSON.parse(row.env) : undefined,
    transport: normalizeMcpServerTransport(row.transport),
    url: row.url || undefined,
    headers: parseHeaders(row.headers),
    headersHelper: normalizeMcpHeadersHelper(row.headers_helper),
    oauthConfig: parseOAuthConfig(row.oauth_config),
    oauthCredentials: parseOAuthCredentials(row.oauth_credentials),
    enabled: row.enabled === 1,
    description: row.description || undefined,
    source: row.source as McpServerConfig['source'],
    providerScope: row.provider_scope ? JSON.parse(row.provider_scope) : undefined,
    trustPolicy: parseTrustPolicy(row.trust_policy),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseHeaders(raw: string | null | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    return normalizeMcpHeaders(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function parseOAuthConfig(raw: string | null | undefined): McpOAuthConfig | undefined {
  if (!raw) return undefined;
  try {
    return normalizeMcpOAuthConfig(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function parseOAuthCredentials(raw: string | null | undefined): McpOAuthCredentials | undefined {
  return unprotectMcpOAuthCredentials(raw);
}

function parseTrustPolicy(raw: string | null | undefined): McpServerTrustPolicy | undefined {
  if (!raw) return undefined;
  try {
    return normalizeMcpServerTrustPolicy(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function stringifyTrustPolicy(value: unknown): string | null {
  const normalized = normalizeMcpServerTrustPolicy(value);
  return normalized ? JSON.stringify(normalized) : null;
}

function stringifyHeaders(value: unknown): string | null {
  const normalized = normalizeMcpHeaders(value);
  return normalized ? JSON.stringify(normalized) : null;
}

function stringifyOAuthConfig(value: unknown): string | null {
  const normalized = normalizeMcpOAuthConfig(value);
  return normalized ? JSON.stringify(normalized) : null;
}

function stringifyOAuthCredentials(value: unknown): string | null {
  return protectMcpOAuthCredentials(value);
}

export class McpServerService {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => number = () => Date.now(),
  ) {}

  listServers(): McpServerConfig[] {
    const rows = this.db.prepare(`
      SELECT id, name, command, args, env, enabled, description,
             source, provider_scope, trust_policy, transport, url, headers,
             headers_helper, oauth_config, oauth_credentials, created_at, updated_at
      FROM mcp_servers ORDER BY name ASC
    `).all() as McpServerRow[];

    return rows.map(rowToConfig);
  }

  createServer(input: CreateMcpServerInput): McpServerConfig {
    const transport = normalizeMcpServerTransport(input.transport);
    if (!input.name || (transport === 'stdio' && !input.command)) {
      throw new McpServerServiceError(400, 'INVALID_INPUT', 'name and command are required for stdio MCP servers');
    }
    if (transport !== 'stdio' && !input.url) {
      throw new McpServerServiceError(400, 'INVALID_INPUT', 'name and url are required for remote MCP servers');
    }

    const existing = this.db.prepare('SELECT id FROM mcp_servers WHERE name = ?').get(input.name);
    if (existing) {
      throw new McpServerServiceError(409, 'DUPLICATE', `MCP server "${input.name}" already exists`);
    }

    const id = newId();
    const now = this.now();

    this.db.prepare(`
      INSERT INTO mcp_servers (
        id, name, command, args, env, enabled, description, source,
        provider_scope, trust_policy, transport, url, headers,
        headers_helper, oauth_config, oauth_credentials, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.command ?? '',
      input.args ? JSON.stringify(input.args) : null,
      input.env ? JSON.stringify(input.env) : null,
      input.enabled !== false ? 1 : 0,
      input.description || null,
      input.providerScope ? JSON.stringify(input.providerScope) : null,
      stringifyTrustPolicy(input.trustPolicy),
      transport,
      input.url || null,
      stringifyHeaders(input.headers),
      normalizeMcpHeadersHelper(input.headersHelper) ?? null,
      stringifyOAuthConfig(input.oauthConfig),
      stringifyOAuthCredentials(input.oauthCredentials),
      now,
      now,
    );

    return this.requireServerById(id);
  }

  updateServer(id: string, input: UpdateMcpServerInput): McpServerConfig {
    this.assertExists(id);

    if (input.name) {
      const duplicate = this.db.prepare('SELECT id FROM mcp_servers WHERE name = ? AND id != ?').get(input.name, id);
      if (duplicate) {
        throw new McpServerServiceError(409, 'DUPLICATE', `MCP server "${input.name}" already exists`);
      }
    }

    this.db.prepare(`
      UPDATE mcp_servers SET
        name = COALESCE(?, name),
        command = COALESCE(?, command),
        args = ?,
        env = ?,
        enabled = COALESCE(?, enabled),
        description = ?,
        provider_scope = ?,
        trust_policy = ?,
        transport = CASE WHEN ? THEN ? ELSE transport END,
        url = CASE WHEN ? THEN ? ELSE url END,
        headers = CASE WHEN ? THEN ? ELSE headers END,
        headers_helper = CASE WHEN ? THEN ? ELSE headers_helper END,
        oauth_config = CASE WHEN ? THEN ? ELSE oauth_config END,
        oauth_credentials = CASE WHEN ? THEN ? ELSE oauth_credentials END,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.name || null,
      input.command || null,
      input.args !== undefined ? JSON.stringify(input.args) : null,
      input.env !== undefined ? JSON.stringify(input.env) : null,
      input.enabled !== undefined ? (input.enabled ? 1 : 0) : null,
      input.description !== undefined ? (input.description || null) : null,
      input.providerScope !== undefined ? (input.providerScope ? JSON.stringify(input.providerScope) : null) : null,
      input.trustPolicy !== undefined ? stringifyTrustPolicy(input.trustPolicy) : null,
      input.transport !== undefined ? 1 : 0,
      input.transport !== undefined ? normalizeMcpServerTransport(input.transport) : null,
      input.url !== undefined ? 1 : 0,
      input.url !== undefined ? (input.url || null) : null,
      input.headers !== undefined ? 1 : 0,
      input.headers !== undefined ? stringifyHeaders(input.headers) : null,
      input.headersHelper !== undefined ? 1 : 0,
      input.headersHelper !== undefined ? (normalizeMcpHeadersHelper(input.headersHelper) ?? null) : null,
      input.oauthConfig !== undefined ? 1 : 0,
      input.oauthConfig !== undefined ? stringifyOAuthConfig(input.oauthConfig) : null,
      input.oauthCredentials !== undefined ? 1 : 0,
      input.oauthCredentials !== undefined ? stringifyOAuthCredentials(input.oauthCredentials) : null,
      this.now(),
      id,
    );

    return this.requireServerById(id);
  }

  deleteServer(id: string): void {
    const result = this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new McpServerServiceError(404, 'NOT_FOUND', 'MCP server not found');
    }
  }

  toggleServer(id: string): McpServerConfig {
    const row = this.db.prepare('SELECT id, enabled FROM mcp_servers WHERE id = ?').get(id) as
      | { id: string; enabled: number }
      | undefined;

    if (!row) {
      throw new McpServerServiceError(404, 'NOT_FOUND', 'MCP server not found');
    }

    const newEnabled = row.enabled === 1 ? 0 : 1;
    this.db.prepare('UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(newEnabled, this.now(), id);

    return this.requireServerById(id);
  }

  findEnabledServerByName(name: string): McpServerConfig | undefined {
    return this.listServers().find((server) => server.name === name && server.enabled);
  }

  updateOAuthCredentials(name: string, credentials: McpOAuthCredentials | null): void {
    this.db.prepare('UPDATE mcp_servers SET oauth_credentials = ?, updated_at = ? WHERE name = ?')
      .run(credentials ? stringifyOAuthCredentials(credentials) : null, this.now(), name);
  }

  private assertExists(id: string): void {
    const existing = this.db.prepare('SELECT id FROM mcp_servers WHERE id = ?').get(id);
    if (!existing) {
      throw new McpServerServiceError(404, 'NOT_FOUND', 'MCP server not found');
    }
  }

  private requireServerById(id: string): McpServerConfig {
    const row = this.db.prepare(`
      SELECT id, name, command, args, env, enabled, description,
             source, provider_scope, trust_policy, transport, url, headers,
             headers_helper, oauth_config, oauth_credentials, created_at, updated_at
      FROM mcp_servers WHERE id = ?
    `).get(id) as McpServerRow | undefined;

    if (!row) {
      throw new McpServerServiceError(404, 'NOT_FOUND', 'MCP server not found');
    }

    return rowToConfig(row);
  }
}
