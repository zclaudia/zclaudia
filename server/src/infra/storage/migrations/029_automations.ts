import type { Migration } from './types.js';

export const migration: Migration = {
  name: '029_automations',
  idempotent: true,
  sql: `
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      trigger TEXT NOT NULL DEFAULT '{}',
      action_kind TEXT NOT NULL CHECK (action_kind IN ('activity', 'workflow')),
      action_ref TEXT NOT NULL,
      action_input TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      system_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id);
    CREATE INDEX IF NOT EXISTS idx_automations_enabled ON automations(enabled);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_automations_system_key ON automations(system_key) WHERE system_key IS NOT NULL;
  `,
};
