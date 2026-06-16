import type { Migration } from './types.js';

/**
 * Widen the tasks.type CHECK constraint to include 'eval' (one-shot Eval tasks
 * run through the shared task lifecycle). SQLite cannot ALTER a CHECK
 * constraint, so we recreate the table with the standard
 * rename-create-copy-drop pattern, mirroring 017. PRAGMA statements stay inside
 * the transaction (no-ops there) so the connection's foreign_keys setting is
 * left unchanged — production runs with enforcement off, and migrations apply
 * either on empty tables (tests) or with enforcement off (production), so the
 * drop never cascades task_events rows. The self-FK and the task_events FK both
 * resolve back to `tasks` after the rename.
 */
export const migration: Migration = {
  name: '018_eval_task_type',
  sql: `
BEGIN;

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS tasks_new (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('agent','command','monitor','external','eval')),
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

INSERT INTO tasks_new
  SELECT id, type, status, parent_task_id, parent_session_id, parent_run_id,
         parent_tool_use_id, session_id, run_id, title, description, executor_ref,
         result, metadata, created_at, updated_at
  FROM tasks;

DROP TABLE tasks;

ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_session_id ON tasks(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_tasks_run_id ON tasks(run_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

PRAGMA foreign_keys = ON;

COMMIT;
  `,
};
