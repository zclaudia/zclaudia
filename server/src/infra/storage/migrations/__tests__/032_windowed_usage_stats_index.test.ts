import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../index.js';
import { ASSISTANT_TOKENS_SUM_WINDOWED_SQL } from '../../../../interfaces/http/usage-stats.js';

function migratedDb(): Database.Database {
  const db = new Database(':memory:');
  applyMigrations(db);
  return db;
}

function planFor(db: Database.Database, sql: string, ...params: unknown[]): string {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{
    detail: string;
  }>;
  return rows.map(r => r.detail).join('; ');
}

describe('032_windowed_usage_stats_index', () => {
  it('creates the composite partial index on messages', () => {
    const db = migratedDb();
    const indexes = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'messages'`)
        .all() as Array<{ name: string }>
    ).map(r => r.name);
    expect(indexes).toContain('idx_messages_assistant_tokens_by_time');
    db.close();
  });

  it('windowed token sum uses the composite index instead of scanning the table', () => {
    const db = migratedDb();
    const plan = planFor(db, ASSISTANT_TOKENS_SUM_WINDOWED_SQL, 0);
    expect(plan).toContain('idx_messages_assistant_tokens_by_time');
    expect(plan).not.toContain('SCAN messages');
    db.close();
  });
});
