import type { Database } from 'better-sqlite3';
import {
  appendMessagesToTree,
  buildUserMessage,
} from '../../../infra/providers/pi-runtime/session-tree/write-path.js';
import { getNextOffset } from './run-lifecycle.js';

export function persistSteeredUserMessage(
  db: Database,
  input: {
    id: string;
    sessionId: string;
    content: string;
    createdAt: number;
  }
): void {
  const offset = getNextOffset(db, input.sessionId);
  db.transaction(() => {
    db.prepare(
      `
      INSERT INTO messages (id, session_id, role, content, metadata, created_at, offset)
      VALUES (?, ?, 'user', ?, ?, ?, ?)
    `
    ).run(
      input.id,
      input.sessionId,
      input.content,
      JSON.stringify({ steered: true }),
      input.createdAt,
      offset
    );
    const entryIds = appendMessagesToTree(db, input.sessionId, [
      buildUserMessage(input.content, []),
    ]);
    db.prepare(`UPDATE messages SET tree_entry_id = ? WHERE id = ?`).run(entryIds[0], input.id);
  })();
}
