import type { Migration } from './types.js';

/**
 * Make agent_profiles.llm_profile_id nullable while KEEPING its FK to
 * llm_profiles(id) ON DELETE RESTRICT, so `claude`/native runtimes can persist
 * NULL (no LLM profile) while `zclaudia` keeps referential integrity. SQLite
 * cannot drop a NOT NULL constraint in place, so we use the standard
 * rebuild-copy-drop-rename pattern.
 *
 * CRITICAL: `PRAGMA foreign_keys` is a NO-OP inside a transaction, so it must be
 * toggled OUTSIDE the BEGIN/COMMIT (before/after). With enforcement genuinely
 * off, `DROP TABLE agent_profiles` does not fire the implicit FK-action delete
 * that would otherwise trip the `sessions.agent_profile_id ... ON DELETE
 * RESTRICT` constraint on a populated database (the failure mode that only shows
 * up when real rows exist — an empty test DB never hits it). The child FKs
 * (sessions, projects) resolve back to `agent_profiles` after the rename; all
 * three indexes are recreated; enforcement is restored after COMMIT.
 *
 * The migration runner runs this via `db.exec` (NOT wrapped in its own
 * transaction) because the SQL contains an explicit `BEGIN` — so the leading
 * `PRAGMA foreign_keys = OFF` executes in autocommit mode and actually takes
 * effect.
 */
export const migration: Migration = {
  name: '036_agent_profile_nullable_llm_profile_id',
  sql: `
PRAGMA foreign_keys = OFF;

BEGIN;

DROP TABLE IF EXISTS agent_profiles_new;

CREATE TABLE agent_profiles_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  llm_profile_id TEXT REFERENCES llm_profiles(id) ON DELETE RESTRICT,
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  system_prompt TEXT NOT NULL DEFAULT '',
  enabled_tools TEXT NOT NULL DEFAULT '["Read","Write","Edit","Bash","Grep","Glob","LS"]',
  tool_selection TEXT,
  multimodal_fallback TEXT,
  thinking_level TEXT,
  is_default INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  skill_selection TEXT,
  skill_execution TEXT,
  source TEXT NOT NULL DEFAULT 'user',
  plugin_id TEXT,
  plugin_profile_id TEXT,
  runtime_type TEXT NOT NULL DEFAULT 'zclaudia'
);

INSERT INTO agent_profiles_new (id, name, description, llm_profile_id, model, system_prompt, enabled_tools, tool_selection, multimodal_fallback, thinking_level, is_default, created_at, updated_at, skill_selection, skill_execution, source, plugin_id, plugin_profile_id, runtime_type)
SELECT id, name, description, llm_profile_id, model, system_prompt, enabled_tools, tool_selection, multimodal_fallback, thinking_level, is_default, created_at, updated_at, skill_selection, skill_execution, source, plugin_id, plugin_profile_id, runtime_type
FROM agent_profiles;

DROP TABLE agent_profiles;

ALTER TABLE agent_profiles_new RENAME TO agent_profiles;

CREATE INDEX IF NOT EXISTS idx_agent_profiles_default ON agent_profiles(is_default);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_llm_profile ON agent_profiles(llm_profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_profiles_plugin_profile
  ON agent_profiles(plugin_id, plugin_profile_id)
  WHERE plugin_id IS NOT NULL AND plugin_profile_id IS NOT NULL;

COMMIT;

PRAGMA foreign_keys = ON;
  `,
};
