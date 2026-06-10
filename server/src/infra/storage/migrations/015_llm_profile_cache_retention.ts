import type { Migration } from './types.js';

export const migration: Migration = {
  name: '015_llm_profile_cache_retention',
  sql: `
ALTER TABLE llm_profiles ADD COLUMN cache_retention TEXT;
  `,
  idempotent: true,
};
