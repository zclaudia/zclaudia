import type { Migration } from './types.js';

export const migration: Migration = {
  name: '035_agent_profile_runtime_type',
  sql: `
ALTER TABLE agent_profiles ADD COLUMN runtime_type TEXT NOT NULL DEFAULT 'zclaudia';
  `,
  idempotent: true,
};
