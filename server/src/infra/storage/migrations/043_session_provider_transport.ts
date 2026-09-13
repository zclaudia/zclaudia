import type { Migration } from './types.js';

/**
 * Cursor transport binding (design: docs/plans/2026-09-12-cursor-acp-migration.md §14).
 *
 * `sessions.provider_transport` records how a provider session is resumed:
 * `cursor-stream-json-v1` for legacy CLI sessions, `cursor-acp-v1` for ACP
 * sessions. The two namespaces are incompatible (a probed stream-json session
 * id cannot be ACP-loaded), so resumes must honor the persisted binding
 * instead of guessing.
 *
 * Backfill (§14.2) is deliberately exact: only historical cursor sessions that
 * already ran (sdk_session_id set) and are unbound become legacy. Empty cursor
 * sessions and other providers stay NULL — their first run decides the
 * transport. `session_runtime_bindings` is not reused: it exists only for
 * dual-engine runtimes and would force engine-mode semantics onto a
 * CLI-only runtime.
 */
export const migration: Migration = {
  name: '043_session_provider_transport',
  sql: `
ALTER TABLE sessions ADD COLUMN provider_transport TEXT;

UPDATE sessions
SET provider_transport = 'cursor-stream-json-v1'
WHERE provider_transport IS NULL
  AND sdk_session_id IS NOT NULL
  AND agent_profile_id IN (
    SELECT id FROM agent_profiles WHERE runtime_type = 'cursor'
  );
`,
};
