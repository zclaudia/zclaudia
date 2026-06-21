import type { Migration } from './types.js';

/**
 * SP-A cross-session fork lineage. Distinct from `parent_session_id` (task /
 * background supervision). `forked_from_session_id` uses ON DELETE SET NULL so a
 * forked session — an independent copy of the tree path — survives deletion of
 * its source, degrading the lineage link to NULL. `fork_entry_id` carries no FK
 * (it names an entry in another session's id space; display/debug only).
 */
export const migration: Migration = {
  name: '024_session_fork_lineage',
  sql: `
ALTER TABLE sessions ADD COLUMN forked_from_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN fork_entry_id TEXT;
  `,
  idempotent: true,
};
