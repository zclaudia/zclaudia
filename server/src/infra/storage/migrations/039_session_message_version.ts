import type { Migration } from './types.js';

/**
 * A message offset only identifies inserted rows. Assistant streaming saves
 * update the same row at the same offset, so offset-only clients cannot tell
 * that their cached body is stale. Keep a monotonic session-level revision and
 * advance the session timestamp for every message mutation so incremental
 * session sync can advertise the new revision.
 */
export const migration: Migration = {
  name: '039_session_message_version',
  sql: `
ALTER TABLE sessions ADD COLUMN message_version INTEGER NOT NULL DEFAULT 0;

UPDATE sessions
SET message_version = (
  SELECT COUNT(*) FROM messages WHERE messages.session_id = sessions.id
);

CREATE TRIGGER IF NOT EXISTS messages_session_version_after_insert
AFTER INSERT ON messages
BEGIN
  UPDATE sessions
  SET message_version = message_version + 1,
      updated_at = MAX(
        updated_at + 1,
        CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
      )
  WHERE id = NEW.session_id;
END;

CREATE TRIGGER IF NOT EXISTS messages_session_version_after_update
AFTER UPDATE ON messages
BEGIN
  UPDATE sessions
  SET message_version = message_version + 1,
      updated_at = MAX(
        updated_at + 1,
        CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
      )
  WHERE id = NEW.session_id;
END;

CREATE TRIGGER IF NOT EXISTS messages_session_version_after_delete
AFTER DELETE ON messages
BEGIN
  UPDATE sessions
  SET message_version = message_version + 1,
      updated_at = MAX(
        updated_at + 1,
        CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
      )
  WHERE id = OLD.session_id;
END;
  `,
};
