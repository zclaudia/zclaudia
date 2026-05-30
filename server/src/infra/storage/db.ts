import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { migrations } from './migrations/index.js';

const DB_DIR = process.env.ZCLAUDIA_DATA_DIR
  ? path.resolve(process.env.ZCLAUDIA_DATA_DIR)
  : path.join(os.homedir(), '.zclaudia');
const DB_PATH = path.join(DB_DIR, 'data.db');

export function initDatabase(): Database.Database {
  // Ensure directory exists
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  // Run migrations
  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  // Create migrations table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `);

  const appliedMigrations = new Set(
    (db.prepare('SELECT name FROM migrations').all() as Array<{ name: string }>).map((row) => row.name)
  );

  for (const migration of migrations) {
    if (appliedMigrations.has(migration.name)) continue;

    console.log(`Applying migration: ${migration.name}`);
    try {
      db.exec(migration.sql);
    } catch (error) {
      // Idempotent migrations tolerate duplicate column errors (schema already applied
      // at the DB level but migration record was missing).
      if (migration.idempotent) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('duplicate column name:')) {
          console.warn(`Migration ${migration.name} already applied at schema level, marking as applied.`);
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
      migration.name,
      Date.now()
    );
  }
}

export type { Database };
