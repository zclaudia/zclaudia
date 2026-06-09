import type { Migration } from './types.js';

export const migration: Migration = {
  name: '010_agent_profile_skill_execution',
  sql: `
ALTER TABLE agent_profiles ADD COLUMN skill_execution TEXT;
  `,
  idempotent: true,
};
