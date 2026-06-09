import type { Migration } from './types.js';

export const migration: Migration = {
  name: '009_agent_profile_skill_selection',
  sql: `
ALTER TABLE agent_profiles ADD COLUMN skill_selection TEXT;
  `,
  idempotent: true,
};
