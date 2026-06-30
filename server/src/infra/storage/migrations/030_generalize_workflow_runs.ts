import type { Migration } from './types.js';

export const migration: Migration = {
  name: '030_generalize_workflow_runs',
  idempotent: false,
  sql: `
    PRAGMA foreign_keys = OFF;

    DROP TABLE IF EXISTS workflow_step_runs;
    DROP TABLE IF EXISTS workflow_runs;

    CREATE TABLE workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT REFERENCES workflows(id) ON DELETE CASCADE,
      project_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
      trigger_source TEXT NOT NULL DEFAULT 'manual'
        CHECK (trigger_source IN ('manual', 'schedule', 'event')),
      trigger_detail TEXT,
      initiator TEXT NOT NULL DEFAULT 'manual',
      action_kind TEXT CHECK (action_kind IN ('activity', 'workflow')),
      action_ref TEXT,
      current_step_id TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_project ON workflow_runs(project_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_initiator ON workflow_runs(initiator);

    CREATE TABLE workflow_step_runs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      step_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'waiting')),
      input TEXT,
      output TEXT,
      error TEXT,
      attempt INTEGER NOT NULL DEFAULT 1,
      session_id TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_run ON workflow_step_runs(run_id);

    PRAGMA foreign_keys = ON;
  `,
};
