import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { migrations, applyPendingMigrations } from './migrations/index.js';
import { ensureDefaultAgentProfile } from '../../domains/agent-profiles/ensure-default-agent-profile.js';
import { backfillProtectedMcpOAuthCredentials } from '../services/mcp-oauth-credential-protector.js';
import { withDevAutoReset } from './dev-db-recovery.js';

const DEFAULT_DB_DIR = process.env.ZCLAUDIA_DATA_DIR
  ? path.resolve(process.env.ZCLAUDIA_DATA_DIR)
  : path.join(os.homedir(), '.zclaudia');

export function initDatabase(dbDir: string = DEFAULT_DB_DIR): Database.Database {
  // Ensure directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, 'data.db');

  // Migrate first; only a genuine schema/migration failure triggers a reset,
  // and only in dev — where the old DB is backed up (never `rm -rf`'d) and a
  // fresh one is recreated. In production the failure propagates untouched.
  const db = withDevAutoReset({
    dbPath,
    env: process.env,
    open: () => openDatabase(dbPath),
    prepare: prepareSchema,
    close: closeForReset,
  });

  // Seed the default agent profile (no-op if one already exists, or if no
  // LlmProfile exists yet — in which case the user will need to create one
  // before they can spawn sessions).
  ensureDefaultAgentProfile(db);

  return db;
}

function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');
  return db;
}

function prepareSchema(db: Database.Database): void {
  runMigrations(db);
  backfillProtectedMcpOAuthCredentials(db);

  // Sanity-check that schema is current — catches stale dev DBs that were
  // created before the providers→llm_profiles rename. Since `001_initial_schema`
  // was modified in place (not as a new migration), pre-rename DBs already have
  // the migration record and skip the re-run, so legacy `providers` table sticks
  // around without `llm_profiles` being created.
  ensureSchemaIsCurrent(db);
}

function closeForReset(db: Database.Database): void {
  // Fold the WAL back into the main file so the backup is self-contained.
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // best effort — an unclosed WAL still travels with the backup below
  }
  db.close();
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

  const names = new Set(tables.map(t => t.name));
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
    const sessionCols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    const sessionColNames = new Set(sessionCols.map(c => c.name));
    if (sessionColNames.has('llm_profile_id') && !sessionColNames.has('agent_profile_id')) {
      throw new Error(
        `[ZClaudia] Schema mismatch: sessions.llm_profile_id exists but sessions.agent_profile_id is missing. ` +
          `Pre-agent-profiles schema. Wipe the data dir and restart:\n` +
          `  rm -rf $ZCLAUDIA_DATA_DIR  (or ~/.zclaudia*)`
      );
    }
  }

  const projectsTableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'projects'")
    .get() as { name: string } | undefined;
  if (projectsTableExists) {
    const projectCols = db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>;
    const projectColNames = new Set(projectCols.map(c => c.name));
    if (projectColNames.has('llm_profile_id') && !projectColNames.has('default_agent_profile_id')) {
      throw new Error(
        `[ZClaudia] Schema mismatch: projects.llm_profile_id exists but projects.default_agent_profile_id is missing. ` +
          `Pre-agent-ui schema. Wipe the data dir and restart:\n  rm -rf $ZCLAUDIA_DATA_DIR`
      );
    }
  }
}

function runMigrations(db: Database.Database): void {
  applyPendingMigrations(db, migrations, { log: true });
}

export type { Database };
