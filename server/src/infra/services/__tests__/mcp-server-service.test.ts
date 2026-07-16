import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { McpServerService, McpServerServiceError } from '../mcp-server-service.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      command TEXT NOT NULL,
      args TEXT,
      env TEXT,
      enabled INTEGER DEFAULT 1,
      description TEXT,
      source TEXT DEFAULT 'user',
      provider_scope TEXT,
      trust_policy TEXT,
      transport TEXT,
      url TEXT,
      headers TEXT,
      headers_helper TEXT,
      oauth_config TEXT,
      oauth_credentials TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);
  return db;
}

describe('McpServerService', () => {
  let db: Database.Database;
  let originalCredentialKey: string | undefined;

  beforeEach(() => {
    originalCredentialKey = process.env.ZCLAUDIA_MCP_CREDENTIAL_KEY;
    process.env.ZCLAUDIA_MCP_CREDENTIAL_KEY = 'mcp-server-service-test-key';
    db = createTestDb();
  });

  afterEach(() => {
    if (originalCredentialKey === undefined) delete process.env.ZCLAUDIA_MCP_CREDENTIAL_KEY;
    else process.env.ZCLAUDIA_MCP_CREDENTIAL_KEY = originalCredentialKey;
    db.close();
  });

  it('creates, lists, updates and toggles servers', () => {
    const service = new McpServerService(db, () => 1234);

    const created = service.createServer({
      name: 'srv',
      command: 'node',
      args: ['server.js'],
      env: { PORT: '3000' },
      providerScope: ['zclaudia'],
    });
    expect(created.name).toBe('srv');
    expect(service.listServers()).toHaveLength(1);

    const updated = service.updateServer(created.id, {
      name: 'srv-updated',
      command: 'python',
      description: 'Test',
    });
    expect(updated.name).toBe('srv-updated');
    expect(updated.command).toBe('python');

    const toggled = service.toggleServer(created.id);
    expect(toggled.enabled).toBe(false);
  });

  it('throws structured errors for missing and duplicate servers', () => {
    const service = new McpServerService(db, () => 1234);
    service.createServer({ name: 'srv', command: 'node' });

    expect(() => service.createServer({ name: 'srv', command: 'node' })).toThrowError(
      McpServerServiceError
    );
    expect(() => service.updateServer('missing', { name: 'x' })).toThrowError(
      McpServerServiceError
    );
    expect(() => service.deleteServer('missing')).toThrowError(McpServerServiceError);
  });

  it('persists and normalizes MCP trust policy', () => {
    const service = new McpServerService(db, () => 1234);

    const created = service.createServer({
      name: 'srv',
      command: 'node',
      trustPolicy: {
        trustLevel: 'trusted-readonly',
        trustReadOnlyHint: true,
        defaultRiskAction: 'ask',
        riskActions: { low: 'auto-approve', medium: 'ask', high: 'deny' },
      },
    });

    expect(created.trustPolicy).toEqual({
      trustLevel: 'trusted-readonly',
      trustReadOnlyHint: true,
      defaultRiskAction: 'ask',
      riskActions: { low: 'auto-approve', medium: 'ask', high: 'deny' },
    });

    const updated = service.updateServer(created.id, {
      trustPolicy: {
        trustLevel: 'trusted',
        trustReadOnlyHint: 'not-a-boolean',
        defaultRiskAction: 'invalid-action',
        riskActions: { low: 'deny', high: 'auto-approve', bogus: 'deny' },
      } as any,
    });

    expect(updated.trustPolicy).toEqual({
      trustLevel: 'trusted',
      trustReadOnlyHint: false,
      defaultRiskAction: 'ask',
      riskActions: { low: 'deny', high: 'auto-approve' },
    });
  });

  it('persists remote transport OAuth configuration and credentials', () => {
    const service = new McpServerService(db, () => 1234);

    const created = service.createServer({
      name: 'remote-github',
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      headers: { 'X-Zoom-Region': 'us01' },
      headersHelper: 'node ./headers-helper.js',
      oauthConfig: {
        enabled: true,
        authorizationEndpoint: 'https://auth.example.com/oauth/authorize',
        tokenEndpoint: 'https://auth.example.com/oauth/token',
        deviceAuthorizationEndpoint: 'https://auth.example.com/oauth/device',
        clientId: 'zclaudia-client',
        clientSecret: 'client-secret',
        scopes: ['repo', 'read:user'],
      },
      oauthCredentials: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        tokenType: 'Bearer',
        expiresAt: 2000,
        scope: 'repo read:user',
      },
    } as any);

    expect(created).toEqual(
      expect.objectContaining({
        name: 'remote-github',
        command: '',
        transport: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        headers: { 'X-Zoom-Region': 'us01' },
        headersHelper: 'node ./headers-helper.js',
        oauthConfig: expect.objectContaining({
          enabled: true,
          authorizationEndpoint: 'https://auth.example.com/oauth/authorize',
          tokenEndpoint: 'https://auth.example.com/oauth/token',
          deviceAuthorizationEndpoint: 'https://auth.example.com/oauth/device',
          clientId: 'zclaudia-client',
          clientSecret: 'client-secret',
          scopes: ['repo', 'read:user'],
        }),
        oauthCredentials: expect.objectContaining({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          tokenType: 'Bearer',
          expiresAt: 2000,
          scope: 'repo read:user',
        }),
      })
    );

    expect(
      service.updateServer(created.id, { description: 'keep oauth' }).oauthCredentials
    ).toEqual(
      expect.objectContaining({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      })
    );
    expect(service.updateServer(created.id, { description: 'keep helper' }).headersHelper).toBe(
      'node ./headers-helper.js'
    );

    const updated = service.updateServer(created.id, {
      headersHelper: null,
      oauthCredentials: null,
      oauthConfig: {
        enabled: true,
        authorizationEndpoint: 'not-a-url',
        tokenEndpoint: 'https://auth.example.com/oauth/token',
        clientId: '',
        scopes: ['repo', 123],
      },
    } as any);

    expect(updated.oauthCredentials).toBeUndefined();
    expect(updated.headersHelper).toBeUndefined();
    expect(updated.oauthConfig).toEqual({
      enabled: true,
      tokenEndpoint: 'https://auth.example.com/oauth/token',
      scopes: ['repo'],
    });
  });

  it('encrypts MCP OAuth credentials at rest while preserving service reads', () => {
    const service = new McpServerService(db, () => 1234);

    const created = service.createServer({
      name: 'secure-remote',
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      oauthCredentials: {
        accessToken: 'access-token-at-rest',
        refreshToken: 'refresh-token-at-rest',
        tokenType: 'Bearer',
        expiresAt: 2000,
      },
    } as any);

    const raw = db
      .prepare('SELECT oauth_credentials FROM mcp_servers WHERE id = ?')
      .get(created.id) as { oauth_credentials: string };
    expect(raw.oauth_credentials).toMatch(/^zclaudia:v1:/);
    expect(raw.oauth_credentials).not.toContain('access-token-at-rest');
    expect(raw.oauth_credentials).not.toContain('refresh-token-at-rest');

    expect(
      service.listServers().find(server => server.id === created.id)?.oauthCredentials
    ).toEqual(
      expect.objectContaining({
        accessToken: 'access-token-at-rest',
        refreshToken: 'refresh-token-at-rest',
        tokenType: 'Bearer',
        expiresAt: 2000,
      })
    );

    service.updateOAuthCredentials('secure-remote', {
      accessToken: 'fresh-access-token-at-rest',
      refreshToken: 'fresh-refresh-token-at-rest',
      tokenType: 'Bearer',
    });
    const refreshed = db
      .prepare('SELECT oauth_credentials FROM mcp_servers WHERE id = ?')
      .get(created.id) as { oauth_credentials: string };
    expect(refreshed.oauth_credentials).toMatch(/^zclaudia:v1:/);
    expect(refreshed.oauth_credentials).not.toContain('fresh-access-token-at-rest');
    expect(refreshed.oauth_credentials).not.toContain('fresh-refresh-token-at-rest');
    expect(service.findEnabledServerByName('secure-remote')?.oauthCredentials).toEqual(
      expect.objectContaining({
        accessToken: 'fresh-access-token-at-rest',
        refreshToken: 'fresh-refresh-token-at-rest',
      })
    );
  });

  it('createServer persists a name-only stdio draft (no command)', () => {
    const service = new McpServerService(db, () => 1234);
    const created = service.createServer({ name: 'draft-server', transport: 'stdio' } as any);
    expect(created.name).toBe('draft-server');
    expect(created.recordStatus).toEqual({
      completeness: 'draft',
      availability: { usable: true },
      disabled: false,
    });
  });

  it('rowToConfig marks a complete enabled stdio server ready (availability optimistic without live state)', () => {
    const service = new McpServerService(db, () => 1234);
    const created = service.createServer({ name: 'fs', command: 'npx', transport: 'stdio' } as any);
    const listed = service.listServers().find(s => s.name === 'fs');
    expect(listed?.recordStatus).toEqual({
      completeness: 'ready',
      availability: { usable: true },
      disabled: false,
    });
  });

  it('continues reading legacy plaintext MCP OAuth credentials', () => {
    db.prepare(
      `
      INSERT INTO mcp_servers (
        id, name, command, enabled, source, transport, url, oauth_credentials, created_at, updated_at
      ) VALUES ('legacy', 'legacy-remote', '', 1, 'user', 'streamable-http', 'https://mcp.example.com/mcp', ?, 1000, 1000)
    `
    ).run(
      JSON.stringify({
        accessToken: 'legacy-access-token',
        refreshToken: 'legacy-refresh-token',
        tokenType: 'Bearer',
      })
    );
    const service = new McpServerService(db, () => 1234);

    expect(service.findEnabledServerByName('legacy-remote')?.oauthCredentials).toEqual(
      expect.objectContaining({
        accessToken: 'legacy-access-token',
        refreshToken: 'legacy-refresh-token',
        tokenType: 'Bearer',
      })
    );
  });
});
