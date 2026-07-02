import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applyPendingMigrations } from '../index.js';

describe('applyPendingMigrations transactions', () => {
  it('rolls back migration SQL when recording the migration would not complete', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at INTEGER NOT NULL
      )
    `);

    expect(() =>
      applyPendingMigrations(db, [
        {
          name: '001_bad',
          sql: `
            CREATE TABLE touched (id INTEGER PRIMARY KEY);
            INSERT INTO missing_table (id) VALUES (1);
          `,
        },
      ])
    ).toThrow();

    const touched = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='touched'")
      .get();
    const applied = db.prepare('SELECT name FROM migrations').all();
    expect(touched).toBeUndefined();
    expect(applied).toEqual([]);

    db.close();
  });
});
