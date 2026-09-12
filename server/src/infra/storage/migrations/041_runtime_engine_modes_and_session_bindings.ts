import type { Migration } from './types.js';

/**
 * Dual-mode runtimes (design: docs/plans/2026-09-11-claude-dual-mode-runtime-design.md,
 * docs/plans/2026-09-11-codex-dual-mode-runtime-design.md).
 *
 * One transactional migration introduces:
 * 1. `agent_profiles.engine_mode` — nullable; NULL means "unset" and is
 *    normalized per runtime (claude/codex default to 'cli'). Only claude/codex
 *    rows are backfilled to 'cli'; other runtimes keep NULL (they do not declare
 *    modes and must not gain one by accident).
 * 2. `llm_profiles.supported_protocols` — explicit endpoint protocol capability
 *    declaration (JSON array of wire protocol ids). NOT backfilled: guessing a
 *    capability the endpoint never declared is exactly what the design forbids;
 *    reads normalize via inference rules instead.
 * 3. `session_runtime_bindings` — the immutable per-session run identity
 *    (engineMode, model, bound LLM profile, connection identity hash, config
 *    namespace). `llm_profile_id` is the canonical FK reference; existing
 *    claude/codex sessions are backfilled as 'cli' bindings using the agent
 *    profile's current model/explicit CLI path — the configuration that is
 *    confirmable at migration time.
 */
export const migration: Migration = {
  name: '041_runtime_engine_modes_and_session_bindings',
  sql: `
ALTER TABLE agent_profiles ADD COLUMN engine_mode TEXT;

UPDATE agent_profiles SET engine_mode = 'cli'
WHERE runtime_type IN ('claude', 'codex') AND engine_mode IS NULL;

ALTER TABLE llm_profiles ADD COLUMN supported_protocols TEXT;

CREATE TABLE IF NOT EXISTS session_runtime_bindings (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  llm_profile_id TEXT REFERENCES llm_profiles(id) ON DELETE RESTRICT,
  runtime_type TEXT NOT NULL,
  engine_mode TEXT NOT NULL,
  model TEXT,
  connection_identity_hash TEXT,
  configured_cli_path TEXT,
  config_namespace TEXT,
  runtime_details TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_runtime_bindings_llm_profile
  ON session_runtime_bindings(llm_profile_id);

INSERT INTO session_runtime_bindings (
  session_id, llm_profile_id, runtime_type, engine_mode, model,
  connection_identity_hash, configured_cli_path, config_namespace,
  runtime_details, created_at, updated_at
)
SELECT
  s.id,
  NULL,
  ap.runtime_type,
  'cli',
  ap.model,
  NULL,
  ap.cli_path,
  NULL,
  NULL,
  s.created_at,
  s.updated_at
FROM sessions s
JOIN agent_profiles ap ON ap.id = s.agent_profile_id
WHERE ap.runtime_type IN ('claude', 'codex');
`,
};
