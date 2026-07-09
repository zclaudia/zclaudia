import type { Migration } from './types.js';

export const migration: Migration = {
  name: '037_agent_profile_cli_path',
  sql: `
ALTER TABLE agent_profiles ADD COLUMN cli_path TEXT;
  `,
  idempotent: true,
};
