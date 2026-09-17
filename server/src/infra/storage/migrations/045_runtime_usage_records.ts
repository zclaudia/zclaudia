import type { Migration } from './types.js';

/**
 * Runtime token usage ledger (design:
 * docs/specs/2026-09-16-runtime-token-usage-design.md §6).
 *
 * One updatable row per invocation — the accounting unit for a single actual
 * runtime call (host dispatch → terminal settlement). Message
 * `metadata.usage` stays as a compatibility projection; this table becomes
 * the single source of truth for token statistics once the legacy backfill
 * (legacy:<messageId> rows) completes.
 *
 * `server_meta` also carries the stable per-database datasetId used to
 * deduplicate multi-backend aggregation, plus the ledger activation marker.
 */
export const migration: Migration = {
  name: '045_runtime_usage_records',
  sql: `
CREATE TABLE IF NOT EXISTS server_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO server_meta (key, value, updated_at)
VALUES ('usage_dataset_id', lower(hex(randomblob(16))), strftime('%s','now') * 1000);

CREATE TABLE IF NOT EXISTS runtime_usage_records (
  invocation_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  assistant_message_id TEXT,
  parent_invocation_id TEXT,

  runtime_id TEXT NOT NULL,
  runtime_version TEXT,
  transport TEXT,
  engine_mode TEXT,
  adapter_version TEXT,
  requested_model TEXT,

  execution_state TEXT NOT NULL DEFAULT 'dispatching',
  started_at INTEGER,
  ended_at INTEGER,
  accounted_at INTEGER,
  updated_at INTEGER NOT NULL,

  usage_status TEXT NOT NULL DEFAULT 'missing',
  reason TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  source_kind TEXT,
  rule_version INTEGER,
  includes_subagents TEXT,

  input_uncached INTEGER,
  cache_read INTEGER,
  cache_write INTEGER,
  output_tokens INTEGER,
  reasoning_output INTEGER,
  total_tokens INTEGER,
  context_used_tokens INTEGER,

  model_breakdown_json TEXT,
  cost_json TEXT,
  discrepancy TEXT,

  source_checkpoint_json TEXT,
  legacy_message_id TEXT,
  accounting_version INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_usage_legacy_message
  ON runtime_usage_records(legacy_message_id)
  WHERE legacy_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_runtime_usage_accounted_at
  ON runtime_usage_records(accounted_at);

CREATE INDEX IF NOT EXISTS idx_runtime_usage_runtime_accounted
  ON runtime_usage_records(runtime_id, accounted_at);

CREATE INDEX IF NOT EXISTS idx_runtime_usage_session
  ON runtime_usage_records(session_id);

CREATE INDEX IF NOT EXISTS idx_runtime_usage_execution_state
  ON runtime_usage_records(execution_state)
  WHERE execution_state IN ('dispatching', 'running');
`,
};
