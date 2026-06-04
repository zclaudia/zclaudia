import type { Migration } from './types.js';

export const migration: Migration = {
  name: '002_request_headers',
  sql: `
ALTER TABLE llm_profiles RENAME COLUMN env TO request_headers;
  `,
};
