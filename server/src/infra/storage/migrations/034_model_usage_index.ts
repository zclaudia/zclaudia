import type { Migration } from './types.js';

/**
 * Covering index for the Models usage chart. Only model-tagged assistant
 * messages qualify (recorded from 2026-07 on), so the index starts
 * near-empty on existing databases. Leading created_at serves the range
 * filter; the JSON expressions must stay textually identical to
 * MODEL_USAGE_SQL / MODEL_TRACKED_SINCE_SQL (usage-stats.ts) or the planner
 * falls back to parsing every metadata blob.
 */
export const migration: Migration = {
  name: '034_model_usage_index',
  sql: `
CREATE INDEX IF NOT EXISTS idx_messages_model_usage
  ON messages(created_at, json_extract(metadata, '$.model'), CAST(json_extract(metadata, '$.usage.totalTokens') AS INTEGER), CAST(json_extract(metadata, '$.usage.output') AS INTEGER))
  WHERE role = 'assistant' AND json_extract(metadata, '$.model') IS NOT NULL;
  `,
};
