import type { Migration } from './types.js';

/**
 * SP-A: link each `messages` UI-projection row to its source `session_entries`
 * tree entry. Forward-only — pre-existing rows stay NULL (fork/branch entry
 * points are disabled on rows without a mapping). New runs and fork/branch
 * re-projection populate it.
 */
export const migration: Migration = {
  name: '025_message_tree_entry_id',
  sql: `
ALTER TABLE messages ADD COLUMN tree_entry_id TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_tree_entry ON messages(session_id, tree_entry_id);
  `,
  idempotent: true,
};
