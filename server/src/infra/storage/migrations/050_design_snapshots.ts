import type { Migration } from './types.js';

export const migration: Migration = {
  name: '050_design_snapshots',
  sql: `
CREATE TABLE IF NOT EXISTS design_snapshots (
  id TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  session_id TEXT,
  entry_path TEXT NOT NULL,
  label TEXT,
  source TEXT NOT NULL,
  run_id TEXT,
  complete INTEGER NOT NULL,
  incomplete_reasons TEXT NOT NULL DEFAULT '[]',
  file_count INTEGER NOT NULL,
  total_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_design_snapshots_ws
  ON design_snapshots(workspace_root, entry_path, created_at);
CREATE TABLE IF NOT EXISTS design_snapshot_files (
  snapshot_id TEXT NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  kind TEXT NOT NULL,
  mime TEXT,
  PRIMARY KEY (snapshot_id, path)
);
CREATE TABLE IF NOT EXISTS design_restore_log (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  session_id TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  report TEXT NOT NULL DEFAULT '{}'
);
`,
  idempotent: true,
};
