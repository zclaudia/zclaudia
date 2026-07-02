import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../migrations/index.js';

describe('migration 005 — llm_profile_oauth', () => {
  it('adds oauth_credentials column to llm_profiles', () => {
    const db = new Database(':memory:');
    applyMigrations(db);

    const cols = db.prepare(`PRAGMA table_info(llm_profiles)`).all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toContain('oauth_credentials');
  });

  it('records migration 005 as applied', () => {
    const db = new Database(':memory:');
    applyMigrations(db);

    const rows = db.prepare(`SELECT name FROM migrations`).all() as Array<{ name: string }>;
    expect(rows.map(r => r.name)).toContain('005_llm_profile_oauth');
  });

  it('allows insert/select of oauth_credentials JSON', () => {
    const db = new Database(':memory:');
    applyMigrations(db);

    const creds = JSON.stringify({ access: 'a', refresh: 'r', expires: 1, accountId: 'acct_x' });
    db.prepare(
      `
      INSERT INTO llm_profiles (id, name, provider_type, oauth_credentials, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run('p1', 'codex', 'openai-codex', creds, 0, 1, 1);

    const row = db.prepare(`SELECT oauth_credentials FROM llm_profiles WHERE id = ?`).get('p1') as {
      oauth_credentials: string;
    };
    expect(JSON.parse(row.oauth_credentials)).toEqual({
      access: 'a',
      refresh: 'r',
      expires: 1,
      accountId: 'acct_x',
    });
  });
});
