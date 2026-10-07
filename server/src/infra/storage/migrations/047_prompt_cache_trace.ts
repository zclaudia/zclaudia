import type { Migration } from './types.js';

/**
 * Prompt-cache diagnostics (docs/plans/2026-10-07-prompt-cache-stats-plan.md
 * Phase 2): one row per run with the cache-relevant prefix fingerprint, and
 * one row per LLM call with its cache split. Keyed by the usage-ledger
 * invocation so a run's diagnostics line up with its accounted usage.
 *
 * Diagnostics only — nothing reads these to build provider requests.
 */
export const migration: Migration = {
  name: '047_prompt_cache_trace',
  sql: `
CREATE TABLE IF NOT EXISTS prompt_cache_runs (
  invocation_id TEXT PRIMARY KEY,
  run_id TEXT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  model TEXT,
  thinking_level TEXT,
  cache_retention TEXT,
  prompt_hash TEXT NOT NULL,
  tools_hash TEXT NOT NULL,
  history_count INTEGER NOT NULL,
  history_hash TEXT NOT NULL,
  -- 1/0 whether the previous run's history survived as this run's prefix;
  -- NULL on a session's first traced run.
  history_prefix_intact INTEGER,
  trimmed_messages INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_prompt_cache_runs_session
  ON prompt_cache_runs(session_id, started_at);

CREATE TABLE IF NOT EXISTS prompt_cache_calls (
  invocation_id TEXT NOT NULL REFERENCES prompt_cache_runs(invocation_id) ON DELETE CASCADE,
  call_index INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  model TEXT,
  input_uncached INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  stop_reason TEXT,
  PRIMARY KEY (invocation_id, call_index)
);

CREATE INDEX IF NOT EXISTS idx_prompt_cache_calls_session
  ON prompt_cache_calls(session_id, at);
`,
};
