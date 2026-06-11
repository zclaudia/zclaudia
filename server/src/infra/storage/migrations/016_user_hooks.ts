import type { Migration } from './types.js';

export const migration: Migration = {
  name: '016_user_hooks',
  sql: `
ALTER TABLE agent_config ADD COLUMN hooks TEXT;
ALTER TABLE projects ADD COLUMN hooks_override TEXT;
  `,
  idempotent: true,
};
