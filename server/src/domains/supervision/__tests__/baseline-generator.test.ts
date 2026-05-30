import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { resolveBaselineProvider } from '../baseline-generator.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT NOT NULL,
      cli_path TEXT,
      env TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

describe('baseline-generator', () => {
  it('returns null when no zclaudia provider is configured', () => {
    const db = createTestDb();
    expect(resolveBaselineProvider(db)).toBeNull();
  });

  it('selects the default zclaudia provider for baseline generation', () => {
    const db = createTestDb();
    const now = Date.now();

    db.prepare(`
      INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('provider-zclaudia', 'ZClaudia Default', 'zclaudia', 1, now, now);

    const provider = resolveBaselineProvider(db);

    expect(provider).toMatchObject({
      id: 'provider-zclaudia',
      type: 'zclaudia',
    });
  });
});
