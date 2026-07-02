import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { loadMcpServersFromDb } from '../mcp-config.js';
import { protectMcpOAuthCredentials } from '../../infra/services/mcp-oauth-credential-protector.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE mcp_servers (
      name TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      args TEXT,
      env TEXT,
      provider_scope TEXT,
      transport TEXT,
      url TEXT,
      headers TEXT,
      headers_helper TEXT,
      oauth_config TEXT,
      oauth_credentials TEXT,
      enabled INTEGER DEFAULT 1
    );
  `);
  return db;
}

describe('mcp-config', () => {
  let db: Database.Database;
  let originalCredentialKey: string | undefined;

  beforeEach(() => {
    originalCredentialKey = process.env.ZCLAUDIA_MCP_CREDENTIAL_KEY;
    process.env.ZCLAUDIA_MCP_CREDENTIAL_KEY = 'mcp-config-test-key';
    db = createTestDb();
  });

  afterEach(() => {
    if (originalCredentialKey === undefined) delete process.env.ZCLAUDIA_MCP_CREDENTIAL_KEY;
    else process.env.ZCLAUDIA_MCP_CREDENTIAL_KEY = originalCredentialKey;
  });

  it('returns empty object when no servers exist', () => {
    const result = loadMcpServersFromDb(db);
    expect(result).toEqual({});
  });

  it('loads enabled MCP servers', () => {
    db.prepare('INSERT INTO mcp_servers (name, command, enabled) VALUES (?, ?, ?)').run(
      'test-server',
      'node',
      1
    );

    const result = loadMcpServersFromDb(db);
    expect(result).toEqual({
      'test-server': { command: 'node', transport: 'stdio' },
    });
  });

  it('excludes disabled servers', () => {
    db.prepare('INSERT INTO mcp_servers (name, command, enabled) VALUES (?, ?, ?)').run(
      'disabled',
      'node',
      0
    );

    const result = loadMcpServersFromDb(db);
    expect(result).toEqual({});
  });

  it('includes args when present', () => {
    db.prepare('INSERT INTO mcp_servers (name, command, args, enabled) VALUES (?, ?, ?, ?)').run(
      's1',
      'node',
      '["--inspect","server.js"]',
      1
    );

    const result = loadMcpServersFromDb(db);
    expect(result['s1'].args).toEqual(['--inspect', 'server.js']);
  });

  it('includes env when present', () => {
    db.prepare('INSERT INTO mcp_servers (name, command, env, enabled) VALUES (?, ?, ?, ?)').run(
      's1',
      'node',
      '{"PORT":"3000"}',
      1
    );

    const result = loadMcpServersFromDb(db);
    expect(result['s1'].env).toEqual({ PORT: '3000' });
  });

  it('filters by provider scope when providerType is given', () => {
    db.prepare(
      'INSERT INTO mcp_servers (name, command, provider_scope, enabled) VALUES (?, ?, ?, ?)'
    ).run('zclaudia-only', 'node', '["zclaudia"]', 1);
    db.prepare(
      'INSERT INTO mcp_servers (name, command, provider_scope, enabled) VALUES (?, ?, ?, ?)'
    ).run('other-only', 'node', '["other"]', 1);

    const result = loadMcpServersFromDb(db, 'zclaudia');
    expect(Object.keys(result)).toEqual(['zclaudia-only']);
  });

  it('includes servers with no scope regardless of providerType filter', () => {
    db.prepare('INSERT INTO mcp_servers (name, command, enabled) VALUES (?, ?, ?)').run(
      'universal',
      'node',
      1
    );

    const result = loadMcpServersFromDb(db, 'zclaudia');
    expect(Object.keys(result)).toEqual(['universal']);
  });

  it('includes servers when provider_scope JSON is invalid', () => {
    db.prepare(
      'INSERT INTO mcp_servers (name, command, provider_scope, enabled) VALUES (?, ?, ?, ?)'
    ).run('bad-scope', 'node', 'not-json', 1);

    const result = loadMcpServersFromDb(db, 'zclaudia');
    expect(Object.keys(result)).toEqual(['bad-scope']);
  });

  it('logs loaded servers when there are results', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    db.prepare('INSERT INTO mcp_servers (name, command, enabled) VALUES (?, ?, ?)').run(
      's1',
      'node',
      1
    );

    loadMcpServersFromDb(db);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Loaded 1 MCP server'));
    consoleSpy.mockRestore();
  });

  it('logs with provider type when filtered', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    db.prepare('INSERT INTO mcp_servers (name, command, enabled) VALUES (?, ?, ?)').run(
      's1',
      'node',
      1
    );

    loadMcpServersFromDb(db, 'zclaudia');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('for zclaudia'));
    consoleSpy.mockRestore();
  });

  it('loads remote MCP server transport, headers, OAuth config, and credentials', () => {
    db.prepare(
      `
      INSERT INTO mcp_servers (
        name, command, enabled, transport, url, headers, headers_helper, oauth_config, oauth_credentials
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      'remote',
      '',
      1,
      'streamable-http',
      'https://mcp.example.com/mcp',
      '{"X-Zoom-Region":"us01"}',
      'node ./headers-helper.js',
      '{"enabled":true,"tokenEndpoint":"https://auth.example.com/token","clientId":"client","scopes":["repo"]}',
      '{"accessToken":"access-token","tokenType":"Bearer"}'
    );

    const result = loadMcpServersFromDb(db);

    expect(result.remote).toEqual({
      transport: 'streamable-http',
      command: '',
      url: 'https://mcp.example.com/mcp',
      headers: { 'X-Zoom-Region': 'us01' },
      headersHelper: 'node ./headers-helper.js',
      oauthConfig: {
        enabled: true,
        tokenEndpoint: 'https://auth.example.com/token',
        clientId: 'client',
        scopes: ['repo'],
      },
      oauthCredentials: {
        accessToken: 'access-token',
        tokenType: 'Bearer',
      },
    });
  });

  it('decrypts protected remote MCP OAuth credentials when loading runtime config', () => {
    const protectedCredentials = protectMcpOAuthCredentials({
      accessToken: 'runtime-access-token',
      refreshToken: 'runtime-refresh-token',
      tokenType: 'Bearer',
    });
    db.prepare(
      `
      INSERT INTO mcp_servers (
        name, command, enabled, transport, url, oauth_credentials
      ) VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      'secure-remote',
      '',
      1,
      'streamable-http',
      'https://mcp.example.com/mcp',
      protectedCredentials
    );

    const result = loadMcpServersFromDb(db);

    expect(result['secure-remote']).toEqual(
      expect.objectContaining({
        oauthCredentials: expect.objectContaining({
          accessToken: 'runtime-access-token',
          refreshToken: 'runtime-refresh-token',
          tokenType: 'Bearer',
        }),
      })
    );
  });
});
