import type { Migration } from './types.js';

/**
 * Defensive backfill: renumber `messages.offset` to a contiguous 1..N per
 * session, ordered by created_at (then existing offset, then id as stable
 * tie-breakers). Fills any NULL offsets and collapses stray/duplicate values.
 *
 * Safe because nothing depends on specific offset VALUES — only their order.
 * Compaction stores `first_kept_message_id` and resolves its offset at read
 * time; `getNextOffset` recomputes MAX+1. Idempotent: created_at order is
 * stable, so re-running produces the same numbering.
 */
export const migration: Migration = {
  name: '020_backfill_message_offset',
  sql: `
WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY session_id
           ORDER BY created_at ASC, offset ASC, id ASC
         ) AS rn
  FROM messages
)
UPDATE messages
SET offset = (SELECT rn FROM ordered WHERE ordered.id = messages.id);
  `,
  idempotent: true,
};
