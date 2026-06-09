import type { Migration } from './types.js';

export const migration: Migration = {
  name: '011_mcp_server_trust_policy',
  sql: `
ALTER TABLE mcp_servers ADD COLUMN trust_policy TEXT;
`,
  idempotent: true,
};
