import type Database from 'better-sqlite3';

export const DEFAULT_AGENT_ID = 'default-agent';

/**
 * Seed a minimal default agent_profile row for tests. Assumes the agent_profiles
 * table already exists. Returns the seeded agent id.
 *
 * Use this in beforeEach when your test inserts a session that needs an FK
 * target — sessions.agent_profile_id is NOT NULL with FK RESTRICT, and
 * SessionRepository auto-resolves to the default agent_profile when callers
 * omit agentProfileId.
 *
 * The insert intentionally lists only the universally-present columns
 * (id, name, is_default, created_at, updated_at). All other agent_profile
 * columns either have defaults (model, system_prompt, enabled_tools) or are
 * nullable (llm_profile_id, description, thinking_level), so this works across
 * every inline schema in the test suite as well as schemas applied via
 * applyMigrations().
 */
export function seedDefaultAgent(
  db: Database.Database,
  opts: { id?: string; name?: string } = {},
): string {
  const id = opts.id ?? DEFAULT_AGENT_ID;
  const name = opts.name ?? 'Default';
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO agent_profiles (id, name, is_default, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?)`,
  ).run(id, name, now, now);
  return id;
}

/**
 * Create a minimal in-memory agent_profiles table for tests that bypass
 * applyMigrations() and build schemas inline. Mirrors the columns that
 * SessionRepository (via resolveAgentForSession) and the seeder rely on,
 * plus the columns AgentProfileRepository writes (defaulted, so tests that
 * never touch them stay green).
 *
 * Also creates an llm_profiles table so resolveAgentForSession's LLM lookup
 * (LlmProfileRepository.findById / .findDefault) doesn't throw
 * "no such table" against fixtures that only need agent resolution. The
 * resolver's LLM lookup falls back gracefully when the table is empty.
 *
 * Most new tests should use applyMigrations(db) instead. This exists so legacy
 * inline-schema tests can drop their bespoke CREATE TABLE blocks.
 */
export function createAgentProfilesTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL DEFAULT 'anthropic',
      base_url TEXT,
      api_key TEXT,
      compat TEXT,
      env TEXT,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      llm_profile_id TEXT,
      model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
      system_prompt TEXT NOT NULL DEFAULT '',
      enabled_tools TEXT NOT NULL DEFAULT '["Read","Write","Edit","Bash","Grep","Find","Glob","LS"]',
      tool_selection TEXT,
      thinking_level TEXT,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}
