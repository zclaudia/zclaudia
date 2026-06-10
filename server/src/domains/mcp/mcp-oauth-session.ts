import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { McpOAuthConfig, McpOAuthCredentials, McpServerConfig } from '@zclaudia/shared/core/mcp';
import { discoverMcpOAuthConfig } from './mcp-oauth-discovery.js';

export type McpOAuthStartResult =
  | { sessionId: string; method: 'browser'; authUrl: string; expiresAt: number }
  | { sessionId: string; method: 'device_code'; userCode: string; verificationUri: string; expiresAt: number };

export type McpOAuthStatus =
  | { state: 'pending' }
  | { state: 'success' }
  | { state: 'error'; code: string; message: string }
  | { state: 'cancelled' };

export interface McpOAuthCredentialWriter {
  updateOAuthCredentials(serverName: string, credentials: McpOAuthCredentials | null): Promise<void> | void;
}

interface Session {
  id: string;
  serverName: string;
  method: 'browser' | 'device_code';
  createdAt: number;
  status: McpOAuthStatus;
  codeVerifier?: string;
  redirectUri?: string;
  abortController: AbortController;
}

const SESSION_TTL_MS = 15 * 60 * 1000;
const CALLBACK_PATH = '/api/mcp-servers/oauth/callback';

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function formBody(values: Record<string, string | undefined>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') body.set(key, value);
  }
  return body;
}

function scopeString(config: McpOAuthConfig): string | undefined {
  return config.scopes && config.scopes.length > 0 ? config.scopes.join(' ') : undefined;
}

function requireOAuthConfig(server: McpServerConfig): McpOAuthConfig {
  const config = server.oauthConfig;
  if (!config?.enabled) throw new Error(`MCP server "${server.name}" OAuth is not enabled`);
  return config;
}

function credentialsFromTokenResponse(token: {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}): McpOAuthCredentials {
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new Error('OAuth token response did not include access_token');
  }
  const expiresIn = typeof token.expires_in === 'number' && Number.isFinite(token.expires_in)
    ? token.expires_in
    : undefined;
  return {
    accessToken: token.access_token,
    refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : undefined,
    tokenType: typeof token.token_type === 'string' ? token.token_type : 'Bearer',
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    scope: typeof token.scope === 'string' ? token.scope : undefined,
  };
}

export class McpOAuthSessionManager {
  private sessions = new Map<string, Session>();

  constructor(
    private readonly writer: McpOAuthCredentialWriter,
    private readonly fetchFn?: typeof fetch,
  ) {}

  async startBrowserFlow(server: McpServerConfig, origin: string): Promise<McpOAuthStartResult> {
    const config = await this.resolveOAuthConfig(server, (cfg) => !!cfg.authorizationEndpoint && !!cfg.tokenEndpoint);
    if (!config.authorizationEndpoint || !config.tokenEndpoint) {
      throw new Error('OAuth authorizationEndpoint and tokenEndpoint are required for browser flow');
    }

    const sessionId = randomUUID();
    const codeVerifier = base64Url(randomBytes(32));
    const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());
    const redirectUri = config.redirectUri || new URL(CALLBACK_PATH, origin).toString();
    const authUrl = new URL(config.authorizationEndpoint);
    authUrl.searchParams.set('response_type', 'code');
    if (config.clientId) authUrl.searchParams.set('client_id', config.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', sessionId);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    const scope = scopeString(config);
    if (scope) authUrl.searchParams.set('scope', scope);

    this.sessions.set(sessionId, {
      id: sessionId,
      serverName: server.name,
      method: 'browser',
      createdAt: Date.now(),
      status: { state: 'pending' },
      codeVerifier,
      redirectUri,
      abortController: new AbortController(),
    });

    return {
      sessionId,
      method: 'browser',
      authUrl: authUrl.toString(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
  }

  async finishBrowserFlow(server: McpServerConfig, sessionId: string, code: string): Promise<void> {
    const session = this.requireSession(server.name, sessionId);
    const config = await this.resolveOAuthConfig(server, (cfg) => !!cfg.tokenEndpoint);
    if (!config.tokenEndpoint || !session.codeVerifier || !session.redirectUri) {
      throw new Error('OAuth session is missing token exchange state');
    }
    try {
      const token = await this.fetchToken(config.tokenEndpoint, {
        grant_type: 'authorization_code',
        code,
        code_verifier: session.codeVerifier,
        redirect_uri: session.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }, session.abortController.signal);
      await this.markSuccess(session, token);
    } catch (err) {
      this.markError(session, 'OAUTH_TOKEN_EXCHANGE_FAILED', err);
      throw err;
    }
  }

  async startDeviceCodeFlow(server: McpServerConfig): Promise<McpOAuthStartResult> {
    const config = await this.resolveOAuthConfig(server, (cfg) => !!cfg.deviceAuthorizationEndpoint && !!cfg.tokenEndpoint);
    if (!config.deviceAuthorizationEndpoint || !config.tokenEndpoint) {
      throw new Error('OAuth deviceAuthorizationEndpoint and tokenEndpoint are required for device-code flow');
    }

    const sessionId = randomUUID();
    const controller = new AbortController();
    const response = await this.fetch(config.deviceAuthorizationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        client_id: config.clientId,
        scope: scopeString(config),
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await response.text());
    const device = await response.json() as {
      device_code?: string;
      user_code?: string;
      verification_uri?: string;
      verification_uri_complete?: string;
      expires_in?: number;
      interval?: number;
    };
    if (!device.device_code || !device.user_code || !device.verification_uri) {
      throw new Error('OAuth device authorization response was incomplete');
    }

    const session: Session = {
      id: sessionId,
      serverName: server.name,
      method: 'device_code',
      createdAt: Date.now(),
      status: { state: 'pending' },
      abortController: controller,
    };
    this.sessions.set(sessionId, session);
    void this.pollDeviceToken(server, session, device.device_code, Math.max(1, device.interval ?? 5), config);

    return {
      sessionId,
      method: 'device_code',
      userCode: device.user_code,
      verificationUri: device.verification_uri_complete || device.verification_uri,
      expiresAt: Date.now() + (device.expires_in ?? 900) * 1000,
    };
  }

  getStatus(sessionId: string): McpOAuthStatus | undefined {
    return this.sessions.get(sessionId)?.status;
  }

  getServerName(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.serverName;
  }

  cancel(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = { state: 'cancelled' };
    session.abortController.abort();
  }

  remove(sessionId: string): void {
    this.cancel(sessionId);
    this.sessions.delete(sessionId);
  }

  private async pollDeviceToken(
    server: McpServerConfig,
    session: Session,
    deviceCode: string,
    intervalSeconds: number,
    resolvedConfig?: McpOAuthConfig,
  ): Promise<void> {
    const config = resolvedConfig ?? await this.resolveOAuthConfig(server, (cfg) => !!cfg.tokenEndpoint);
    try {
      while (session.status.state === 'pending' && !session.abortController.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 10));
        const token = await this.fetchToken(config.tokenEndpoint!, {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }, session.abortController.signal);
        await this.markSuccess(session, token);
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/authorization_pending/i.test(message)) {
        void this.pollDeviceToken(server, session, deviceCode, intervalSeconds, config);
        return;
      }
      if (session.abortController.signal.aborted) return;
      this.markError(session, 'OAUTH_DEVICE_TOKEN_FAILED', err);
    }
  }

  private requireSession(serverName: string, sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session || session.serverName !== serverName) throw new Error('OAuth session not found or expired');
    return session;
  }

  private async resolveOAuthConfig(
    server: McpServerConfig,
    hasRequiredEndpoints: (config: McpOAuthConfig) => boolean,
  ): Promise<McpOAuthConfig> {
    const config = requireOAuthConfig(server);
    if (hasRequiredEndpoints(config)) return config;
    return discoverMcpOAuthConfig(config, server.url, (input, init) => this.fetch(input, init));
  }

  private async fetchToken(tokenEndpoint: string, params: Record<string, string | undefined>, signal: AbortSignal): Promise<McpOAuthCredentials> {
    const response = await this.fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody(params),
      signal,
    });
    if (!response.ok) throw new Error(await response.text());
    return credentialsFromTokenResponse(await response.json() as {
      access_token?: unknown;
      refresh_token?: unknown;
      token_type?: unknown;
      expires_in?: unknown;
      scope?: unknown;
    });
  }

  private async markSuccess(session: Session, credentials: McpOAuthCredentials): Promise<void> {
    session.status = { state: 'success' };
    await this.writer.updateOAuthCredentials(session.serverName, credentials);
  }

  private fetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
    return (this.fetchFn ?? globalThis.fetch)(input, init);
  }

  private markError(session: Session, code: string, err: unknown): void {
    session.status = {
      state: 'error',
      code,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
