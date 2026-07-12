import type { Migration } from './types.js';

export const migration: Migration = {
  name: '038_agent_profile_status',
  sql: `
ALTER TABLE agent_profiles ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','readonly'));
  `,
  idempotent: true,
};
