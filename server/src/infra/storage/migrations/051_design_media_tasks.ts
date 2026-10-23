import type { Migration } from './types.js';

export const migration: Migration = {
  name: '051_design_media_tasks',
  sql: `
CREATE TABLE IF NOT EXISTS design_media_tasks (
  id TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  params_json TEXT NOT NULL,
  provider_json TEXT,
  progress_json TEXT,
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  dedup_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_design_media_tasks_ws
  ON design_media_tasks(workspace_root, created_at);
CREATE INDEX IF NOT EXISTS idx_design_media_tasks_active
  ON design_media_tasks(workspace_root, dedup_key, status);
`,
  idempotent: true,
};
