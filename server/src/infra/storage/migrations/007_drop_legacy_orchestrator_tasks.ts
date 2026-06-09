import type { Migration } from './types.js';

export const migration: Migration = {
  name: '007_drop_legacy_orchestrator_tasks',
  sql: `
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS claudia_branches_next (
  id TEXT PRIMARY KEY,
  host_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  active_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_task_id TEXT
);

INSERT OR REPLACE INTO claudia_branches_next (
  id, host_project_id, active_session_id, title, created_at, updated_at, last_task_id
)
SELECT id, host_project_id, active_session_id, title, created_at, updated_at, last_task_id
FROM claudia_branches;

DROP TABLE claudia_branches;
ALTER TABLE claudia_branches_next RENAME TO claudia_branches;

CREATE INDEX IF NOT EXISTS idx_claudia_branches_project ON claudia_branches(host_project_id);

DROP TABLE IF EXISTS orchestrator_tasks;

PRAGMA foreign_keys = ON;
  `,
};
