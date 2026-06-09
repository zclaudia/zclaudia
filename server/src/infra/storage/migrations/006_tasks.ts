import type { Migration } from './types.js';

export const migration: Migration = {
  name: '006_tasks',
  sql: `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('agent','command','monitor','external')),
  status TEXT NOT NULL CHECK(status IN ('queued','running','paused','completed','failed','stopped')),
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  parent_session_id TEXT,
  parent_run_id TEXT,
  parent_tool_use_id TEXT,
  session_id TEXT,
  run_id TEXT,
  title TEXT,
  description TEXT,
  executor_ref TEXT,
  result TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_session_id ON tasks(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_run_id ON tasks(run_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('created','started','paused','completed','failed','stopped','updated')),
  status TEXT CHECK(status IN ('queued','running','paused','completed','failed','stopped')),
  payload TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_task_events_created_at ON task_events(created_at);
  `,
};
