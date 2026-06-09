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

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
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

    expect(() => service.createServer({ name: 'srv', command: 'node' })).toThrowError(McpServerServiceError);
    expect(() => service.updateServer('missing', { name: 'x' })).toThrowError(McpServerServiceError);
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

    expect(created).toEqual(expect.objectContaining({
      name: 'remote-github',
      command: '',
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      headers: { 'X-Zoom-Region': 'us01' },
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
    }));

    expect(service.updateServer(created.id, { description: 'keep oauth' }).oauthCredentials).toEqual(expect.objectContaining({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    }));

    const updated = service.updateServer(created.id, {
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
    expect(updated.oauthConfig).toEqual({
      enabled: true,
      tokenEndpoint: 'https://auth.example.com/oauth/token',
      scopes: ['repo'],
    });
  });
});
