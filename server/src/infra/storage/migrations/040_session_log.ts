import type { Migration } from './types.js';

/**
 * pi 0.84 replaced the session tree's shape. Entries no longer carry the whole
 * model on their own: they gained a monotonic `seq`, their timestamps became
 * epoch numbers, the active leaf moved from a pointer table into named lanes,
 * labels became facts, and a parallel stream of lane records (operations, tool
 * starts, usage) now shares the entries' sequence. One ordered stream, not a
 * tree plus a pointer.
 *
 * `session_log` stores that stream verbatim — one row per mutation, replayed in
 * order to rebuild a session. `getLog` is then a range scan rather than a union
 * across tables.
 *
 * The old rows are dropped rather than converted. `session_entries` has no
 * sequence to recover (its order was timestamp-then-id, which is not the same
 * relation), and its `leaf` and `label` entry types have no counterpart to be
 * converted into without inventing sequence positions for them. What is lost is
 * the pi-native context tree: branch lineage and compaction ancestry for
 * sessions created before this migration. Conversation history itself lives in
 * `messages` and is untouched — an old session still opens and still reads
 * back; it starts a fresh tree from its next turn.
 */
export const migration: Migration = {
  name: '040_session_log',
  sql: `
DROP TABLE IF EXISTS session_entries;
DROP TABLE IF EXISTS session_leaf;

CREATE TABLE IF NOT EXISTS session_log (
  session_id  TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);
`,
  idempotent: true,
};
