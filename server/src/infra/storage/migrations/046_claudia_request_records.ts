import type { Migration } from './types.js';

/**
 * Claudia P0 request idempotency ledger (design §去重与恢复).
 *
 * One row per client-visible request outcome. The PRIMARY KEY on
 * client_request_id is the transport dedup: a replayed request resolves to the
 * recorded outcome instead of allocating a second branch/session/run. Same id
 * with a different payload/target is a conflict, not a replay.
 *
 * `outcome` mirrors what the client was told:
 * - 'accepted'  — run admission passed; session_id/run_id carry the identity
 * - 'rejected'  — the request never started; error_code says why
 * - 'uncertain' — registered but the run start crashed before any receipt
 */
export const migration: Migration = {
  name: '046_claudia_request_records',
  sql: `
CREATE TABLE IF NOT EXISTS claudia_request_records (
  client_request_id   TEXT PRIMARY KEY,
  caller_scope        TEXT NOT NULL,
  project_id          TEXT NOT NULL,
  branch_id           TEXT,
  session_id          TEXT,
  run_id              TEXT,
  payload_fingerprint TEXT NOT NULL,
  outcome             TEXT NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'uncertain')),
  error_code          TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claudia_request_records_session
  ON claudia_request_records(session_id);
`,
};
