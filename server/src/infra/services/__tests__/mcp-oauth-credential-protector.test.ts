import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  backfillProtectedMcpOAuthCredentials,
  protectMcpOAuthCredentials,
  unprotectMcpOAuthCredentials,
} from '../mcp-oauth-credential-protector.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      oauth_credentials TEXT
    )
  `);
  return db;
}

describe('MCP OAuth credential protector', () => {
  let db: Database.Database;
  let originalCredentialKey: string | undefined;

  beforeEach(() => {
    originalCredentialKey = process.env.ZCLAUDIA_MCP_CREDENTIAL_KEY;
    process.env.ZCLAUDIA_MCP_CREDENTIAL_KEY = 'mcp-credential-protector-test-key';
    db = createDb();
  });

  afterEach(() => {
    db.close();
    if (originalCredentialKey === undefined) delete process.env.ZCLAUDIA_MCP_CREDENTIAL_KEY;
    else process.env.ZCLAUDIA_MCP_CREDENTIAL_KEY = originalCredentialKey;
  });

  it('backfills legacy plaintext MCP OAuth credentials into encrypted envelopes', () => {
    db.prepare('INSERT INTO mcp_servers (id, name, oauth_credentials) VALUES (?, ?, ?)').run(
      'plain',
      'plain-server',
      JSON.stringify({
        accessToken: 'legacy-access-token',
        refreshToken: 'legacy-refresh-token',
        tokenType: 'Bearer',
      })
    );

    const changed = backfillProtectedMcpOAuthCredentials(db);

    expect(changed).toBe(1);
    const row = db
      .prepare('SELECT oauth_credentials FROM mcp_servers WHERE id = ?')
      .get('plain') as { oauth_credentials: string };
    expect(row.oauth_credentials).toMatch(/^zclaudia:v1:/);
    expect(row.oauth_credentials).not.toContain('legacy-access-token');
    expect(row.oauth_credentials).not.toContain('legacy-refresh-token');
    expect(unprotectMcpOAuthCredentials(row.oauth_credentials)).toEqual(
      expect.objectContaining({
        accessToken: 'legacy-access-token',
        refreshToken: 'legacy-refresh-token',
        tokenType: 'Bearer',
      })
    );
  });

  it('does not rewrite already protected or invalid MCP OAuth credential rows', () => {
    const protectedValue = protectMcpOAuthCredentials({
      accessToken: 'already-protected-token',
      tokenType: 'Bearer',
    });
    db.prepare('INSERT INTO mcp_servers (id, name, oauth_credentials) VALUES (?, ?, ?)').run(
      'protected',
      'protected-server',
      protectedValue
    );
    db.prepare('INSERT INTO mcp_servers (id, name, oauth_credentials) VALUES (?, ?, ?)').run(
      'invalid',
      'invalid-server',
      'not-json'
    );

    const changed = backfillProtectedMcpOAuthCredentials(db);

    expect(changed).toBe(0);
    const rows = db
      .prepare('SELECT id, oauth_credentials FROM mcp_servers ORDER BY id')
      .all() as Array<{
      id: string;
      oauth_credentials: string;
    }>;
    expect(rows.find(row => row.id === 'protected')?.oauth_credentials).toBe(protectedValue);
    expect(rows.find(row => row.id === 'invalid')?.oauth_credentials).toBe('not-json');
  });
});
