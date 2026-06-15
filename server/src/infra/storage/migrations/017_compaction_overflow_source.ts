import type { Migration } from './types.js';

/**
 * Widen the session_compactions.source CHECK constraint to include 'overflow'.
 * SQLite does not support ALTER COLUMN to modify a CHECK constraint, so we
 * recreate the table using the standard rename-create-copy-drop pattern.
 * Foreign key enforcement is disabled for the duration of the operation
 * (the FK structure is preserved identically).
 */
export const migration: Migration = {
  name: '017_compaction_overflow_source',
  sql: `
BEGIN;

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS session_compactions_new (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  first_kept_message_id TEXT NOT NULL,
  tokens_before INTEGER NOT NULL,
  details TEXT,
  source TEXT NOT NULL CHECK(source IN ('auto', 'manual', 'overflow')) DEFAULT 'auto',
  custom_instructions TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (first_kept_message_id) REFERENCES messages(id) ON DELETE CASCADE
);

INSERT INTO session_compactions_new
  SELECT id, session_id, summary, first_kept_message_id, tokens_before,
         details, source, custom_instructions, created_at
  FROM session_compactions;

DROP TABLE session_compactions;

ALTER TABLE session_compactions_new RENAME TO session_compactions;

CREATE INDEX IF NOT EXISTS idx_session_compactions_session_created
  ON session_compactions(session_id, created_at DESC);

PRAGMA foreign_keys = ON;

COMMIT;
  `,
};
