import type { Migration } from './types.js';

export const migration: Migration = {
  name: '008_agent_profile_tool_selection',
  sql: `
ALTER TABLE agent_profiles ADD COLUMN tool_selection TEXT;
  `,
  idempotent: true,
};
