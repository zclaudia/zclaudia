import type { Migration } from './types.js';

/**
 * Route C: the session tree (pi-native) becomes the context source of truth.
 * `session_entries` is an append-only adjacency tree (one row per pi
 * SessionTreeEntry); `session_leaf` records the active leaf per session.
 * The `messages` table is henceforth a linear projection of the active path.
 *
 * Composite primary key (session_id, id) enables id reuse on fork: the same
 * entry id can legitimately appear under a different session_id when
 * forkSessionAt path-copies a branch into a new session, preserving intra-
 * payload id references (compaction.firstKeptEntryId, branch_summary.fromId,
 * label.targetId).
 */
export const migration: Migration = {
  name: '021_session_entries',
  sql: `
CREATE TABLE IF NOT EXISTS session_entries (
  id          TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  parent_id   TEXT,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  timestamp   TEXT NOT NULL,
  PRIMARY KEY (session_id, id)
);
CREATE INDEX IF NOT EXISTS idx_session_entries_parent ON session_entries(parent_id);

CREATE TABLE IF NOT EXISTS session_leaf (
  session_id  TEXT PRIMARY KEY,
  leaf_id     TEXT
);
`,
  idempotent: true,
};
