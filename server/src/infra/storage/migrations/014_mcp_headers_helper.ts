import type { Migration } from './types.js';

export const migration: Migration = {
  name: '014_mcp_headers_helper',
  sql: `
ALTER TABLE mcp_servers ADD COLUMN headers_helper TEXT;
`,
  idempotent: true,
};
