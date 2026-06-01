import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { migrations } from './migrations/index.js';
import { ensureDefaultAgentProfile } from '../../domains/agent-profiles/ensure-default-agent-profile.js';

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

  // Sanity-check that schema is current — catches stale dev DBs that were
  // created before the providers→llm_profiles rename. Since `001_initial_schema`
  // was modified in place (not as a new migration), pre-rename DBs already have
  // the migration record and skip the re-run, so legacy `providers` table sticks
  // around without `llm_profiles` being created.
  ensureSchemaIsCurrent(db);

  // Seed the default agent profile (no-op if one already exists, or if no
  // LlmProfile exists yet — in which case the user will need to create one
  // before they can spawn sessions).
  ensureDefaultAgentProfile(db);

  return db;
}

/**
 * Detect stale dev DBs where the legacy `providers` table still exists but
 * `llm_profiles` is missing (i.e. the DB predates the providers→llm_profiles
 * rename and the migration record blocks the schema rewrite). Also detects
 * pre-agent-profiles DBs that lack `agent_profiles` or still have the legacy
 * `sessions.llm_profile_id` column. Throws with a clear remediation message
 * instead of letting downstream queries fail.
 */
export function ensureSchemaIsCurrent(db: Database.Database): void {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('providers', 'llm_profiles', 'agent_profiles')"
    )
    .all() as Array<{ name: string }>;

  const names = new Set(tables.map((t) => t.name));
  if (names.has('providers') && !names.has('llm_profiles')) {
    throw new Error(
      `[ZClaudia] Schema mismatch: legacy 'providers' table exists but 'llm_profiles' is missing. ` +
        `This happens when an existing dev DB predates the providers→llm_profiles rename. ` +
        `Wipe the data dir and restart:\n` +
        `  rm -rf $ZCLAUDIA_DATA_DIR  (or ~/.zclaudia*)\n` +
        `  bash scripts/dev/start-app.sh`
    );
  }

  if (names.has('llm_profiles') && !names.has('agent_profiles')) {
    throw new Error(
      `[ZClaudia] Schema mismatch: 'llm_profiles' exists but 'agent_profiles' is missing. ` +
        `This happens when an existing dev DB predates the agent_profiles introduction. ` +
        `Wipe the data dir and restart:\n` +
        `  rm -rf $ZCLAUDIA_DATA_DIR  (or ~/.zclaudia*)\n` +
        `  bash scripts/dev/start-app.sh`
    );
  }

  const sessionsTableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'sessions'")
    .get() as { name: string } | undefined;
  if (sessionsTableExists) {
    const sessionCols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    const sessionColNames = new Set(sessionCols.map((c) => c.name));
    if (sessionColNames.has('llm_profile_id') && !sessionColNames.has('agent_profile_id')) {
      throw new Error(
        `[ZClaudia] Schema mismatch: sessions.llm_profile_id exists but sessions.agent_profile_id is missing. ` +
          `Pre-agent-profiles schema. Wipe the data dir and restart:\n` +
          `  rm -rf $ZCLAUDIA_DATA_DIR  (or ~/.zclaudia*)`
      );
    }
  }
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
