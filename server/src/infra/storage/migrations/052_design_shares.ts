import type { Migration } from './types.js';

export const migration: Migration = {
  name: '052_design_shares',
  sql: `
CREATE TABLE IF NOT EXISTS design_shares (
  id TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  session_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  title TEXT,
  scope TEXT NOT NULL DEFAULT 'link',
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  last_access_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_design_shares_ws ON design_shares(workspace_root, created_at);
CREATE INDEX IF NOT EXISTS idx_design_shares_snapshot ON design_shares(snapshot_id);

CREATE TABLE IF NOT EXISTS design_share_comments (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  target_json TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_design_share_comments_share
  ON design_share_comments(share_id, created_at);
`,
  idempotent: true,
};
