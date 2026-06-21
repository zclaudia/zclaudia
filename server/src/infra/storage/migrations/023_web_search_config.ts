import type { Migration } from './types.js';

export const migration: Migration = {
  name: '023_web_search_config',
  sql: `
CREATE TABLE IF NOT EXISTS web_search_config (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  brave_api_key TEXT,
  searxng_base_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO web_search_config (id, created_at, updated_at)
VALUES (1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
`,
  idempotent: true,
};
