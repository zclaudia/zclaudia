import type { Migration } from './types.js';

export const migration: Migration = {
  name: '044_session_model_settings',
  sql: `CREATE TABLE session_model_settings (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    model TEXT,
    thinking_level TEXT,
    revision INTEGER NOT NULL DEFAULT 1
  );`,
};
