import type { Migration } from './types.js';

export const migration: Migration = {
  name: '003_llm_profile_models',
  sql: `
ALTER TABLE llm_profiles ADD COLUMN models TEXT;
ALTER TABLE agent_profiles DROP COLUMN context_window;
  `,
};
