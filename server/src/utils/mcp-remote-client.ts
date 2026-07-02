import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { execFile } from 'node:child_process';
import type { McpOAuthConfig, McpOAuthCredentials } from '@zclaudia/shared/core/mcp';
import { discoverMcpOAuthConfig } from '../domains/mcp/mcp-oauth-discovery.js';
import type {
  McpPromptDefinition,
  McpPromptResult,
  McpResourceDefinition,
  McpResourceResult,
  McpToolDefinition,
  McpToolResult,
} from './mcp-client.js';

export interface RemoteMcpClientConfig {
  serverName?: string;
  transport: 'streamable-http' | 'sse';
  url: string;
  headers?: Record<string, string>;
  headersHelper?: string;
  headersHelperRunner?: (
    command: string,
    context: { serverName?: string; url: string }
  ) => Promise<Record<string, string>>;
  oauthConfig?: McpOAuthConfig;
  oauthCredentials?: McpOAuthCredentials;
  fetchFn?: typeof fetch;
  onOAuthCredentials?: (credentials: McpOAuthCredentials | null) => void | Promise<void>;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}

const REFRESH_SKEW_MS = 60_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const HEADERS_HELPER_TIMEOUT_MS = 10_000;

function shouldRefresh(credentials?: McpOAuthCredentials): boolean {
  return (
    !!credentials?.refreshToken &&
    typeof credentials.expiresAt === 'number' &&
    credentials.expiresAt <= Date.now() + REFRESH_SKEW_MS
  );
}

function formBody(values: Record<string, string | undefined>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) body.set(key, value);
  }
  return body;
}

function credentialsFromTokenResponse(
  token: {
    access_token?: unknown;
    refresh_token?: unknown;
    token_type?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  },
  previous?: McpOAuthCredentials
): McpOAuthCredentials {
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new Error('OAuth refresh response did not include access_token');
  }
  const expiresIn =
    typeof token.expires_in === 'number' && Number.isFinite(token.expires_in)
      ? token.expires_in
      : undefined;
  return {
    accessToken: token.access_token,
    refreshToken:
      typeof token.refresh_token === 'string' && token.refresh_token
        ? token.refresh_token
        : previous?.refreshToken,
    tokenType:
      typeof token.token_type === 'string' && token.token_type
        ? token.token_type
        : (previous?.tokenType ?? 'Bearer'),
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    scope: typeof token.scope === 'string' && token.scope ? token.scope : previous?.scope,
  };
}

function isTerminalRefreshError(message: string): boolean {
  return /\b(invalid_grant|refresh_token_expired|refresh_token_invalidated|refresh_token_reused)\b/i.test(
    message
  );
}

function runHeadersHelper(
  command: string,
  context: { serverName?: string; url: string }
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [],
      {
        shell: true,
        timeout: HEADERS_HELPER_TIMEOUT_MS,
        env: {
          ...process.env,
          ZCLAUDIA_MCP_SERVER_NAME: context.serverName ?? '',
          ZCLAUDIA_MCP_SERVER_URL: context.url,
        },
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as unknown;
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('headersHelper must return a JSON object');
          }
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value !== 'string')
              throw new Error(`headersHelper value for ${key} must be a string`);
            headers[key] = value;
          }
          resolve(headers);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

async function requestHeaders(
  config: RemoteMcpClientConfig,
  credentials = config.oauthCredentials
): Promise<Record<string, string>> {
  const headers = { ...(config.headers ?? {}) };
  if (config.headersHelper) {
    const dynamicHeaders = await (config.headersHelperRunner ?? runHeadersHelper)(
      config.headersHelper,
      {
        serverName: config.serverName,
        url: config.url,
      }
    );
    Object.assign(headers, dynamicHeaders);
  }
  if (credentials?.accessToken) {
    headers.Authorization = `${credentials.tokenType || 'Bearer'} ${credentials.accessToken}`;
  }
  return headers;
}

function withRequestTimeout(config: RemoteMcpClientConfig): typeof fetch {
  const baseFetch = config.fetchFn ?? globalThis.fetch;
  const timeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  return async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET') return baseFetch(input, init);

    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted) controller.abort(upstreamSignal.reason);
    else upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });

    const timeout = setTimeout(
      () => controller.abort(new Error(`Remote MCP request timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    try {
      return await baseFetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener('abort', abortFromUpstream);
    }
  };
}

export class RemoteMcpClient {
  private client: Client | null = null;
  private transportInstance: StreamableHTTPClientTransport | SSEClientTransport | null = null;
  private connected = false;

  constructor(private readonly config: RemoteMcpClientConfig) {}

  async connect(): Promise<void> {
    if (this.connected) return;
    const oauthCredentials = await this.resolveOAuthCredentials();
    const headers = await requestHeaders(this.config, oauthCredentials);
    const requestInit = Object.keys(headers).length > 0 ? { headers } : undefined;
    const fetch = withRequestTimeout(this.config);
    this.client = new Client(
      { name: 'zclaudia-mcp-client', version: '0.1.0' },
      { capabilities: {} }
    );
    this.transportInstance =
      this.config.transport === 'sse'
        ? new SSEClientTransport(new URL(this.config.url), { requestInit, fetch })
        : new StreamableHTTPClientTransport(new URL(this.config.url), { requestInit, fetch });
    await this.withConnectTimeout(this.client.connect(this.transportInstance));
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    await this.transportInstance?.close();
    this.transportInstance = null;
    this.client = null;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get instructions(): string | undefined {
    return this.client?.getInstructions();
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.requireClient().listTools();
    return result.tools.map(tool => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<
        string,
        unknown
      >,
      annotations: (tool as { annotations?: Record<string, unknown> }).annotations,
    })) as McpToolDefinition[];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const result = await this.requireClient().callTool({ name, arguments: args });
    return {
      content: (result.content ?? []) as McpToolResult['content'],
      isError: typeof result.isError === 'boolean' ? result.isError : undefined,
    };
  }

  async listResources(): Promise<McpResourceDefinition[]> {
    const result = await this.requireClient().listResources();
    return result.resources.map(resource => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
    }));
  }

  async readResource(uri: string): Promise<McpResourceResult> {
    const result = await this.requireClient().readResource({ uri });
    return { contents: result.contents as McpResourceResult['contents'] };
  }

  async listPrompts(): Promise<McpPromptDefinition[]> {
    const result = await this.requireClient().listPrompts();
    return result.prompts.map(prompt => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments,
    }));
  }

  async getPrompt(name: string, args?: Record<string, unknown>): Promise<McpPromptResult> {
    const result = await this.requireClient().getPrompt({
      name,
      arguments: (args ?? {}) as Record<string, string>,
    });
    return {
      description: result.description,
      messages: result.messages as McpPromptResult['messages'],
    };
  }

  private requireClient(): Client {
    if (!this.client) throw new Error('Remote MCP client is not connected');
    return this.client;
  }

  private async withConnectTimeout<T>(promise: Promise<T>): Promise<T> {
    const timeoutMs = this.config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Remote MCP connection timed out after ${timeoutMs}ms`)),
            timeoutMs
          );
        }),
      ]);
    } catch (error) {
      this.connected = false;
      await this.transportInstance?.close();
      this.transportInstance = null;
      this.client = null;
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async resolveOAuthCredentials(): Promise<McpOAuthCredentials | undefined> {
    if (!shouldRefresh(this.config.oauthCredentials)) return this.config.oauthCredentials;
    if (this.config.oauthConfig?.enabled && !this.config.oauthConfig.tokenEndpoint) {
      this.config.oauthConfig = await discoverMcpOAuthConfig(
        this.config.oauthConfig,
        this.config.url,
        this.config.fetchFn ?? globalThis.fetch
      );
    }
    const tokenEndpoint = this.config.oauthConfig?.tokenEndpoint;
    const refreshToken = this.config.oauthCredentials?.refreshToken;
    if (!tokenEndpoint || !refreshToken) return this.config.oauthCredentials;

    const response = await (this.config.fetchFn ?? globalThis.fetch)(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.config.oauthConfig?.clientId,
        client_secret: this.config.oauthConfig?.clientSecret,
      }),
    });
    if (!response.ok) {
      const message = await response.text();
      if (isTerminalRefreshError(message)) {
        this.config.oauthCredentials = undefined;
        await this.config.onOAuthCredentials?.(null);
      }
      throw new Error(`OAuth refresh failed: ${message || response.status}`);
    }

    const fresh = credentialsFromTokenResponse(
      (await response.json()) as {
        access_token?: unknown;
        refresh_token?: unknown;
        token_type?: unknown;
        expires_in?: unknown;
        scope?: unknown;
      },
      this.config.oauthCredentials
    );
    this.config.oauthCredentials = fresh;
    await this.config.onOAuthCredentials?.(fresh);
    return fresh;
  }
}
