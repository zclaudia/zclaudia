import type { Migration } from './types.js';

export const migration: Migration = {
  name: '026_session_goals',
  sql: `
CREATE TABLE IF NOT EXISTS session_goals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  objective_text TEXT NOT NULL,
  status TEXT NOT NULL,
  token_budget INTEGER NOT NULL,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  max_turns INTEGER NOT NULL,
  turns_used INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  end_reason TEXT,
  last_verdict_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS session_goals_active
  ON session_goals(session_id)
  WHERE status IN ('active', 'paused');

CREATE INDEX IF NOT EXISTS session_goals_session
  ON session_goals(session_id);
  `,
  idempotent: true,
};
