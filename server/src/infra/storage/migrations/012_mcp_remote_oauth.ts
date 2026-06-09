import type { Migration } from './types.js';

export const migration: Migration = {
  name: '012_mcp_remote_oauth',
  sql: `
ALTER TABLE mcp_servers ADD COLUMN transport TEXT DEFAULT 'stdio';
ALTER TABLE mcp_servers ADD COLUMN url TEXT;
ALTER TABLE mcp_servers ADD COLUMN headers TEXT;
ALTER TABLE mcp_servers ADD COLUMN oauth_config TEXT;
ALTER TABLE mcp_servers ADD COLUMN oauth_credentials TEXT;
`,
  idempotent: true,
};
