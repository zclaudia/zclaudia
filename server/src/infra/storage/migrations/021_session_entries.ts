import type { Migration } from './types.js';

/**
 * Route C: the session tree (pi-native) becomes the context source of truth.
 * `session_entries` is an append-only adjacency tree (one row per pi
 * SessionTreeEntry); `session_leaf` records the active leaf per session.
 * The `messages` table is henceforth a linear projection of the active path.
 */
export const migration: Migration = {
  name: '021_session_entries',
  sql: `
CREATE TABLE IF NOT EXISTS session_entries (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  parent_id   TEXT,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  timestamp   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_entries_session ON session_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_session_entries_parent ON session_entries(parent_id);

CREATE TABLE IF NOT EXISTS session_leaf (
  session_id  TEXT PRIMARY KEY,
  leaf_id     TEXT
);
  `,
  idempotent: true,
};
