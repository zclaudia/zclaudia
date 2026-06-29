import type { Migration } from './types.js';

export const migration: Migration = {
  name: '028_agent_loop_contexts',
  sql: `
CREATE TABLE IF NOT EXISTS agent_loop_contexts (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  context_key TEXT NOT NULL,
  policy TEXT NOT NULL,
  summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_loop_contexts_owner_key
  ON agent_loop_contexts(owner_type, owner_id, context_key);

CREATE INDEX IF NOT EXISTS idx_agent_loop_contexts_owner
  ON agent_loop_contexts(owner_type, owner_id);

CREATE TABLE IF NOT EXISTS agent_loop_events (
  id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (context_id) REFERENCES agent_loop_contexts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_loop_events_context_time
  ON agent_loop_events(context_id, created_at);
  `,
  idempotent: true,
};
