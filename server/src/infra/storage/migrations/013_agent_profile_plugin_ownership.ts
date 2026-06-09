import type { Migration } from './types.js';

export const migration: Migration = {
  name: '013_agent_profile_plugin_ownership',
  sql: `
ALTER TABLE agent_profiles ADD COLUMN source TEXT NOT NULL DEFAULT 'user';
ALTER TABLE agent_profiles ADD COLUMN plugin_id TEXT;
ALTER TABLE agent_profiles ADD COLUMN plugin_profile_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_profiles_plugin_profile
  ON agent_profiles(plugin_id, plugin_profile_id)
  WHERE plugin_id IS NOT NULL AND plugin_profile_id IS NOT NULL;
  `,
  idempotent: true,
};
