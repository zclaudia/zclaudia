import type { Migration } from './types.js';

export const migration: Migration = {
  name: '019_session_auto_title',
  sql: `
ALTER TABLE sessions ADD COLUMN auto_title TEXT;
ALTER TABLE sessions ADD COLUMN auto_title_msg_count INTEGER;
  `,
  idempotent: true,
};
