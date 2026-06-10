/**
 * MCP Client Manager — connection pool for MCP server processes.
 *
 * Caches McpClient instances by server name.
 * Idle connections are automatically closed after 60 seconds.
 */

import {
  McpClient,
  type McpResourceDefinition,
  type McpResourceResult,
  type McpPromptDefinition,
  type McpPromptResult,
  type McpToolDefinition,
  type McpToolResult,
} from './mcp-client.js';
import { RemoteMcpClient } from './mcp-remote-client.js';
import { mcpInventoryCache } from './mcp-inventory-cache.js';
import type { McpServerStatus } from '@zclaudia/shared/core/mcp';
import type { McpServerRuntimeConfig, McpStdioServerConfig } from './mcp-config.js';

interface CachedClient {
  client: McpClient | RemoteMcpClient;
  configKey: string;
  lastUsed: number;
  idleTimer: NodeJS.Timeout;
}

const IDLE_TIMEOUT_MS = 60_000; // 60 seconds

function isAuthRequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(401|403|unauthorized|forbidden|auth(?:entication|orization)? required|oauth|login required)\b/i.test(message);
}

function authRequiredMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `MCP server requires authentication before tools can be used. ${message}`;
}

function isMcpSessionExpiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  return (
    (code === 404 || /\b404\b/.test(message))
    && (
      message.includes('"code":-32001')
      || message.includes('"code": -32001')
      || /session not found/i.test(message)
    )
  );
}

export class McpClientManager {
  private clients = new Map<string, CachedClient>();
  /** Deduplicates concurrent getClient() calls for the same server. */
  private connecting = new Map<string, Promise<McpClient | RemoteMcpClient>>();
  private statuses = new Map<string, McpServerStatus>();

  private buildConfigKey(config: McpServerRuntimeConfig): string {
    const sortedEnv = Object.entries('env' in config ? config.env || {} : {}).sort(([a], [b]) => a.localeCompare(b));
    const sortedHeaders = Object.entries('headers' in config ? config.headers || {} : {}).sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify({
      transport: config.transport || 'stdio',
      command: config.command,
      args: 'args' in config ? config.args || [] : [],
      env: sortedEnv,
      url: 'url' in config ? config.url : undefined,
      headers: sortedHeaders,
      headersHelper: 'headersHelper' in config ? config.headersHelper : undefined,
      oauthConfig: 'oauthConfig' in config ? config.oauthConfig : undefined,
      oauthCredentials: 'oauthCredentials' in config ? config.oauthCredentials : undefined,
    });
  }

  /**
   * Get or create an McpClient for the given MCP server.
   * Concurrent calls for the same serverName are deduplicated.
   */
  async getClient(
    serverName: string,
    config: McpServerRuntimeConfig,
  ): Promise<McpClient | RemoteMcpClient> {
    const configKey = this.buildConfigKey(config);
    const cached = this.clients.get(serverName);
    if (cached?.client.isConnected && cached.configKey === configKey) {
      cached.lastUsed = Date.now();
      this.resetIdleTimer(serverName, cached);
      this.markStatus(serverName, { state: 'connected' });
      return cached.client;
    }

    // Deduplicate concurrent connection attempts for the same server
    const pending = this.connecting.get(serverName);
    if (pending) return pending;

    const promise = this.createClient(serverName, configKey, config);
    this.connecting.set(serverName, promise);
    try {
      return await promise;
    } finally {
      this.connecting.delete(serverName);
    }
  }

  private async createClient(
    serverName: string,
    configKey: string,
    config: McpServerRuntimeConfig,
  ): Promise<McpClient | RemoteMcpClient> {
    // Clean up stale entry, including config changes for the same server name.
    const cached = this.clients.get(serverName);
    if (cached) {
      mcpInventoryCache.invalidate(serverName);
      await this.evict(serverName);
    }

    this.markStatus(serverName, { state: 'connecting', lastError: undefined });
    let client: McpClient | RemoteMcpClient;
    if ('url' in config && (config.transport === 'streamable-http' || config.transport === 'sse')) {
      client = new RemoteMcpClient({
        serverName,
        transport: config.transport,
        url: config.url,
        headers: config.headers,
        headersHelper: config.headersHelper,
        oauthConfig: config.oauthConfig,
        oauthCredentials: config.oauthCredentials,
        onOAuthCredentials: config.onOAuthCredentials,
      });
    } else {
      const stdioConfig = config as McpStdioServerConfig;
      client = new McpClient(stdioConfig.command, stdioConfig.args || [], stdioConfig.env);
    }
    try {
      await client.connect();
    } catch (err) {
      if (isAuthRequiredError(err)) {
        this.markStatus(serverName, {
          state: 'needs-auth',
          lastError: err instanceof Error ? err.message : String(err),
          authRequired: true,
          authMessage: authRequiredMessage(err),
        });
        throw err;
      }
      this.markStatus(serverName, {
        state: 'failed',
        lastError: err instanceof Error ? err.message : String(err),
        authRequired: false,
        authMessage: undefined,
      });
      throw err;
    }

    const entry: CachedClient = {
      client,
      configKey,
      lastUsed: Date.now(),
      idleTimer: setTimeout(() => this.evict(serverName), IDLE_TIMEOUT_MS),
    };
    this.clients.set(serverName, entry);
    this.markStatus(serverName, {
      state: 'connected',
      lastConnectedAt: Date.now(),
      lastError: undefined,
      authRequired: false,
      authMessage: undefined,
      hasInstructions: !!client.instructions,
      instructions: client.instructions,
    });

    return client;
  }

  async connect(
    serverName: string,
    config: McpServerRuntimeConfig,
  ): Promise<McpClient | RemoteMcpClient> {
    return this.getClient(serverName, config);
  }

  async disconnect(serverName: string): Promise<void> {
    mcpInventoryCache.invalidate(serverName);
    await this.evict(serverName);
    this.markStatus(serverName, {
      state: 'idle-disconnected',
      lastDisconnectedAt: Date.now(),
    });
  }

  async refresh(
    serverName: string,
    config: McpServerRuntimeConfig,
  ): Promise<McpClient | RemoteMcpClient> {
    mcpInventoryCache.invalidate(serverName);
    await this.evict(serverName);
    return this.getClient(serverName, config);
  }

  getStatus(serverName: string): McpServerStatus {
    if (this.connecting.has(serverName)) {
      return { ...this.statuses.get(serverName), name: serverName, state: 'connecting' };
    }
    const cached = this.clients.get(serverName);
    if (cached?.client.isConnected) {
      return { ...this.statuses.get(serverName), name: serverName, state: 'connected' };
    }
    return this.statuses.get(serverName) ?? { name: serverName, state: 'configured' };
  }

  listStatuses(): McpServerStatus[] {
    const names = new Set([...this.statuses.keys(), ...this.clients.keys(), ...this.connecting.keys()]);
    return [...names].sort().map((name) => this.getStatus(name));
  }

  /**
   * Call a tool on a named MCP server.
   */
  async callTool(
    serverName: string,
    config: McpServerRuntimeConfig,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    return this.withSessionRetry(serverName, config, async (client) => client.callTool(toolName, args));
  }

  /**
   * List tools on a named MCP server.
   */
  async listTools(
    serverName: string,
    config: McpServerRuntimeConfig,
  ): Promise<McpToolDefinition[]> {
    return this.withSessionRetry(serverName, config, async (client) => client.listTools());
  }

  async listResources(
    serverName: string,
    config: McpServerRuntimeConfig,
  ): Promise<McpResourceDefinition[]> {
    return this.withSessionRetry(serverName, config, async (client) => client.listResources());
  }

  async readResource(
    serverName: string,
    config: McpServerRuntimeConfig,
    uri: string,
  ): Promise<McpResourceResult> {
    return this.withSessionRetry(serverName, config, async (client) => client.readResource(uri));
  }

  async listPrompts(
    serverName: string,
    config: McpServerRuntimeConfig,
  ): Promise<McpPromptDefinition[]> {
    return this.withSessionRetry(serverName, config, async (client) => client.listPrompts());
  }

  async getPrompt(
    serverName: string,
    config: McpServerRuntimeConfig,
    name: string,
    args?: Record<string, unknown>,
  ): Promise<McpPromptResult> {
    return this.withSessionRetry(serverName, config, async (client) => client.getPrompt(name, args));
  }

  /**
   * Shutdown all cached connections.
   */
  async shutdown(): Promise<void> {
    const names = [...this.clients.keys()];
    await Promise.all(names.map(name => this.evict(name)));
  }

  private resetIdleTimer(name: string, entry: CachedClient): void {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => this.evict(name), IDLE_TIMEOUT_MS);
  }

  private async withSessionRetry<T>(
    serverName: string,
    config: McpServerRuntimeConfig,
    operation: (client: McpClient | RemoteMcpClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.getClient(serverName, config);
    try {
      return await operation(client);
    } catch (error) {
      if (!isMcpSessionExpiredError(error)) throw error;
      mcpInventoryCache.invalidate(serverName);
      await this.evict(serverName);
      this.markStatus(serverName, {
        state: 'connecting',
        lastError: undefined,
        authRequired: false,
        authMessage: undefined,
      });
      const freshClient = await this.getClient(serverName, config);
      return operation(freshClient);
    }
  }

  private async evict(name: string): Promise<void> {
    const entry = this.clients.get(name);
    if (!entry) return;

    clearTimeout(entry.idleTimer);
    this.clients.delete(name);

    try {
      await entry.client.disconnect();
      this.markStatus(name, {
        state: 'idle-disconnected',
        lastDisconnectedAt: Date.now(),
      });
      console.log(`[McpClientManager] Disconnected idle MCP server: ${name}`);
    } catch (err) {
      console.error(`[McpClientManager] Error disconnecting ${name}:`, err);
    }
  }

  private markStatus(name: string, patch: Partial<McpServerStatus>): void {
    const previous = this.statuses.get(name) ?? { name, state: 'configured' as const };
    this.statuses.set(name, { ...previous, ...patch, name });
  }
}

/** Singleton instance */
export const mcpClientManager = new McpClientManager();
