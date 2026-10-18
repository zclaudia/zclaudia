import type { Migration } from './types.js';

export const migration: Migration = {
  name: '049_auto_title_config',
  sql: `
CREATE TABLE IF NOT EXISTS auto_title_config (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  enabled INTEGER NOT NULL DEFAULT 1,
  model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO auto_title_config (id, enabled, created_at, updated_at)
VALUES (1, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
`,
  idempotent: true,
};
