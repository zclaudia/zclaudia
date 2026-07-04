import type { Migration } from './types.js';

/**
 * Windowed token sums for the stats range switcher (30d/7d). Migration 031's
 * expression index has no created_at column, so a `created_at >= ?` filter
 * would force a per-row table lookup that drags the large metadata blobs
 * back in. This composite partial index leads with created_at (range scan)
 * and repeats the token expression as the second column so the windowed SUM
 * stays index-only. The expression must remain textually identical to
 * ASSISTANT_TOKENS_SUM_WINDOWED_SQL (usage-stats.ts).
 */
export const migration: Migration = {
  name: '032_windowed_usage_stats_index',
  sql: `
CREATE INDEX IF NOT EXISTS idx_messages_assistant_tokens_by_time
  ON messages(created_at, CAST(json_extract(metadata, '$.usage.totalTokens') AS INTEGER))
  WHERE role = 'assistant' AND metadata IS NOT NULL;
  `,
};
