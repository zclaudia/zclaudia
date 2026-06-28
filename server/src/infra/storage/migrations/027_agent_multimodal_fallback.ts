import type { Migration } from './types.js';

export const migration: Migration = {
  name: '027_agent_multimodal_fallback',
  sql: `
ALTER TABLE agent_profiles ADD COLUMN multimodal_fallback TEXT;
  `,
  idempotent: true,
};
