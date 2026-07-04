import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations, applyPendingMigrations, migrations } from '../index.js';
import {
  ASSISTANT_TOKENS_SUM_SQL,
  ACTIVE_DAYS_SQL,
  computeUsageStats,
} from '../../../../interfaces/http/usage-stats.js';

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

describe('031_usage_stats_indexes', () => {
  it('creates both partial indexes on messages', () => {
    const db = migratedDb();
    const indexes = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'messages'`)
        .all() as Array<{ name: string }>
    ).map(r => r.name);
    expect(indexes).toContain('idx_messages_assistant_usage_tokens');
    expect(indexes).toContain('idx_messages_user_created_at');
    db.close();
  });

  it('token sum uses the expression index instead of JSON-parsing every row', () => {
    const db = migratedDb();
    expect(planFor(db, ASSISTANT_TOKENS_SUM_SQL)).toContain(
      'idx_messages_assistant_usage_tokens'
    );
    db.close();
  });

  it('active-days bucketing uses the partial created_at index', () => {
    const db = migratedDb();
    expect(planFor(db, ACTIVE_DAYS_SQL, 0)).toContain('idx_messages_user_created_at');
    db.close();
  });

  it('backfills existing rows: sums pre-migration metadata correctly', () => {
    // Index creation must cover rows inserted before the migration ran —
    // simulate by seeding on the pre-031 schema, then applying 031.
    const db = new Database(':memory:');
    applyPendingMigrations(db, migrations.filter(m => m.name < '031'));
    db.pragma('foreign_keys = OFF');
    const insert = db.prepare(
      'INSERT INTO messages (id, session_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    insert.run('m1', 's1', 'assistant', 'x', JSON.stringify({ usage: { totalTokens: 700 } }), 1);
    insert.run('m2', 's1', 'assistant', 'x', JSON.stringify({ toolCalls: [] }), 2);
    insert.run('m3', 's1', 'user', 'x', null, Date.now());

    applyMigrations(db);

    const stats = computeUsageStats(db);
    expect(stats.totalTokens).toBe(700);
    expect(stats.messages).toBe(3);
    db.close();
  });
});
