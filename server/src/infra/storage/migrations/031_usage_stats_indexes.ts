import type { Migration } from './types.js';

/**
 * Home usage-stats endpoint indexes. The token total previously required a
 * synchronous full-table scan that JSON-parsed every assistant message's
 * metadata blob (toolCalls/thinkingBlocks included) on each cache miss —
 * hundreds of ms at 100k+ messages.
 *
 * `idx_messages_assistant_usage_tokens` is a partial expression index:
 * SQLite pre-computes the token count per row at write time and the SUM in
 * `ASSISTANT_TOKENS_SUM_SQL` (usage-stats.ts) becomes an index-only scan of
 * small integers — no JSON parsing, no writer-side bookkeeping to keep in
 * sync. The index expression must stay textually identical to the query's
 * SUM argument or the planner falls back to the full scan.
 *
 * `idx_messages_user_created_at` serves the active-days day bucketing the
 * same way (covering partial index over user-message timestamps).
 */
export const migration: Migration = {
  name: '031_usage_stats_indexes',
  sql: `
CREATE INDEX IF NOT EXISTS idx_messages_assistant_usage_tokens
  ON messages(CAST(json_extract(metadata, '$.usage.totalTokens') AS INTEGER))
  WHERE role = 'assistant' AND metadata IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_user_created_at
  ON messages(created_at) WHERE role = 'user';
  `,
};
