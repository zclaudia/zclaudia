import type { Migration } from './types.js';

import { migration as m_001_initial_schema } from './001_initial_schema.js';
import { migration as m_002_request_headers } from './002_request_headers.js';
import { migration as m_003_llm_profile_models } from './003_llm_profile_models.js';

export type { Migration };

export const migrations: Migration[] = [
  m_001_initial_schema,
  m_002_request_headers,
  m_003_llm_profile_models,
];

/**
 * Apply all migrations to a database. Idempotent — uses the same `migrations`
 * tracking table as production `runMigrations` in db.ts. Intended for tests
 * that need a fully-migrated in-memory DB without going through `initDatabase`.
 */
export function applyMigrations(db: import('better-sqlite3').Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT name FROM migrations').all() as Array<{ name: string }>).map((r) => r.name),
  );

  const insert = db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)');

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    try {
      db.exec(migration.sql);
    } catch (error) {
      if (migration.idempotent) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('duplicate column name:')) {
          // Schema already applied; record and continue.
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    insert.run(migration.name, Date.now());
  }
}
