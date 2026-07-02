import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migrations, applyMigrations } from '../migrations/index.js';
import type { Migration } from '../migrations/types.js';

/**
 * Migration 004 — fold legacy `provider_type = 'openai-custom'` into `'openai'`.
 *
 * Runs migrations 001-003 to build the llm_profiles table, seeds a row with
 * the legacy type, applies 004, and asserts the row's provider_type is
 * rewritten while every other column is preserved.
 */
describe('migration 004 — merge openai-custom into openai', () => {
  function findMigration(name: string): Migration {
    const found = migrations.find(m => m.name === name);
    if (!found) throw new Error(`migration ${name} not registered`);
    return found;
  }

  function applyOnly(db: Database.Database, ...names: string[]): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at INTEGER NOT NULL
      )
    `);
    const insert = db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)');
    for (const name of names) {
      const migration = findMigration(name);
      db.exec(migration.sql);
      insert.run(migration.name, Date.now());
    }
  }

  it('rewrites a legacy openai-custom row to openai while preserving other columns', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Apply only the migrations that precede 004 so we can seed legacy data
    // before the rewrite runs.
    applyOnly(db, '001_initial_schema', '002_request_headers', '003_llm_profile_models');

    // Seed a row in the pre-004 shape. base_url is non-null because the
    // legacy editor required it for openai-custom; the migration must keep
    // every other column untouched.
    db.prepare(
      `
      INSERT INTO llm_profiles
        (id, name, provider_type, base_url, api_key, compat, request_headers, models, is_default, created_at, updated_at)
      VALUES
        (?,  ?,    ?,             ?,        ?,       ?,      ?,               ?,      ?,          ?,          ?)
    `
    ).run(
      'p1',
      'DeepSeek',
      'openai-custom',
      'http://127.0.0.1:3000/v1',
      'sk-secret',
      JSON.stringify({ supportsReasoningEffort: false }),
      JSON.stringify({ 'X-Org': 'acme' }),
      JSON.stringify([{ modelId: 'deepseek-chat' }]),
      1,
      111,
      222
    );

    // Apply migration 004.
    applyOnly(db, '004_merge_openai_custom');

    const row = db.prepare('SELECT * FROM llm_profiles WHERE id = ?').get('p1') as {
      provider_type: string;
      base_url: string;
      api_key: string;
      compat: string;
      request_headers: string;
      models: string;
      is_default: number;
      created_at: number;
      updated_at: number;
    };
    expect(row.provider_type).toBe('openai');
    // Side fields must be preserved verbatim — only provider_type changes.
    expect(row.base_url).toBe('http://127.0.0.1:3000/v1');
    expect(row.api_key).toBe('sk-secret');
    expect(JSON.parse(row.compat)).toEqual({ supportsReasoningEffort: false });
    expect(JSON.parse(row.request_headers)).toEqual({ 'X-Org': 'acme' });
    expect(JSON.parse(row.models)).toEqual([{ modelId: 'deepseek-chat' }]);
    expect(row.is_default).toBe(1);
    expect(row.created_at).toBe(111);
    expect(row.updated_at).toBe(222);

    db.close();
  });

  it('leaves anthropic rows unchanged', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyOnly(db, '001_initial_schema', '002_request_headers', '003_llm_profile_models');
    db.prepare(
      `
      INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run('p2', 'A', 'anthropic', 1, 2);

    applyOnly(db, '004_merge_openai_custom');

    const row = db.prepare('SELECT provider_type FROM llm_profiles WHERE id = ?').get('p2') as {
      provider_type: string;
    };
    expect(row.provider_type).toBe('anthropic');
    db.close();
  });

  it('full applyMigrations() pipeline ends with no openai-custom rows', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);

    // A fresh DB has no rows, but the SELECT must still succeed against the
    // post-004 schema — verifying the migration tracking entry is recorded.
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM llm_profiles WHERE provider_type = 'openai-custom'")
      .get() as { n: number };
    expect(count.n).toBe(0);

    const applied = db
      .prepare("SELECT name FROM migrations WHERE name = '004_merge_openai_custom'")
      .get();
    expect(applied).toBeDefined();

    db.close();
  });
});
