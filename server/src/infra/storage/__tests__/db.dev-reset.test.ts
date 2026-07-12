import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initDatabase } from '../db.js';
import { migrations } from '../migrations/index.js';

/**
 * End-to-end coverage for the migrate-first / dev-only backup+reset recovery
 * wired into initDatabase. Uses a real sqlite DB in a temp dir (initDatabase
 * takes an explicit dbDir), seeded into the exact legacy state ensureSchemaIsCurrent
 * is built to reject: every migration recorded as applied, plus a stray legacy
 * `providers` table and no `llm_profiles`.
 */
function seedIncompatibleDb(dir: string): void {
  const seed = new Database(path.join(dir, 'data.db'));
  seed.exec(
    `CREATE TABLE migrations (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL UNIQUE,
       applied_at INTEGER NOT NULL
     )`
  );
  const insert = seed.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)');
  for (const m of migrations) insert.run(m.name, 1);
  seed.exec('CREATE TABLE providers (id TEXT PRIMARY KEY)');
  seed.close();
}

function backupFiles(dir: string): string[] {
  return readdirSync(dir).filter(f => f.startsWith('data.db.bak-'));
}

describe('initDatabase dev schema recovery', () => {
  let dir: string;
  let originalChannel: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'zc-initdb-'));
    originalChannel = process.env.ZCLAUDIA_CHANNEL;
  });
  afterEach(() => {
    if (originalChannel === undefined) delete process.env.ZCLAUDIA_CHANNEL;
    else process.env.ZCLAUDIA_CHANNEL = originalChannel;
    rmSync(dir, { recursive: true, force: true });
  });

  it('backs up an incompatible dev DB and recreates a fresh schema', () => {
    process.env.ZCLAUDIA_CHANNEL = 'dev';
    seedIncompatibleDb(dir);

    const db = initDatabase(dir);
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('providers','agent_profiles')"
        )
        .all() as Array<{ name: string }>
    ).map(t => t.name);
    db.close();

    // Fresh schema: agent_profiles present, the legacy providers table gone.
    expect(tables).toContain('agent_profiles');
    expect(tables).not.toContain('providers');
    // The old DB was preserved as a backup, not deleted.
    expect(backupFiles(dir)).toHaveLength(1);
  });

  it('rethrows an incompatible schema in prod and leaves the data untouched', () => {
    process.env.ZCLAUDIA_CHANNEL = 'prod';
    seedIncompatibleDb(dir);

    expect(() => initDatabase(dir)).toThrow();
    expect(backupFiles(dir)).toHaveLength(0);
  });
});
