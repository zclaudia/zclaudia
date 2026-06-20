import type { Migration } from './types.js';

/**
 * Route C cleanup: compaction results now live as native pi `CompactionEntry`
 * nodes in `session_entries` (migration 021), not rows in `session_compactions`.
 * The table and its repository have no remaining readers, so drop it.
 */
export const migration: Migration = {
  name: '022_drop_session_compactions',
  sql: `DROP TABLE IF EXISTS session_compactions;`,
  idempotent: true,
};
