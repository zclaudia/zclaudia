import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../index.js';
import { MODEL_USAGE_SQL } from '../../../../interfaces/http/usage-stats.js';

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

describe('034_model_usage_index', () => {
  it('creates the covering index on messages', () => {
    const db = migratedDb();
    const indexes = (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'messages'`)
        .all() as Array<{ name: string }>
    ).map(r => r.name);
    expect(indexes).toContain('idx_messages_model_usage');
    db.close();
  });

  it('model usage aggregation uses the covering index instead of scanning the table', () => {
    const db = migratedDb();
    const plan = planFor(db, MODEL_USAGE_SQL, 0);
    // eslint-disable-next-line no-console
    console.log('034 query plan:', plan);
    expect(plan).toContain('idx_messages_model_usage');
    expect(plan).not.toContain('SCAN messages');
    db.close();
  });
});
