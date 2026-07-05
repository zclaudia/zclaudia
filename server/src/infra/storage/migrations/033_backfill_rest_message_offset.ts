import type { Migration } from './types.js';

/**
 * Backfill NULL `messages.offset` rows left by the REST POST /:id/messages
 * route, which inserted without an offset until SessionMessageRepository.create
 * learned to assign MAX+1. Same renumbering as 020, but scoped to sessions
 * that actually contain a NULL offset so already-contiguous sessions are
 * untouched. Safe because nothing depends on specific offset VALUES — only
 * their order. Idempotent: after the first run no NULLs remain, so re-running
 * is a no-op.
 */
export const migration: Migration = {
  name: '033_backfill_rest_message_offset',
  sql: `
WITH affected AS (
  SELECT DISTINCT session_id FROM messages WHERE offset IS NULL
),
ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY session_id
           ORDER BY created_at ASC, offset ASC, id ASC
         ) AS rn
  FROM messages
  WHERE session_id IN (SELECT session_id FROM affected)
)
UPDATE messages
SET offset = (SELECT rn FROM ordered WHERE ordered.id = messages.id)
WHERE session_id IN (SELECT session_id FROM affected);
  `,
  idempotent: true,
};
