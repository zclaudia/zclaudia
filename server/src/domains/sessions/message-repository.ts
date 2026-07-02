import type { Database } from 'better-sqlite3';
import type { MessageRole } from '@zclaudia/shared/core/message';

export interface StoredSessionMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  metadata: string | null;
  createdAt: number;
  offset: number | null;
  treeEntryId?: string;
}

export interface SessionMessageListOptions {
  limit: number;
  before?: number;
  after?: number;
  afterOffset?: number;
  aroundMessageId?: string;
}

export interface CreateSessionMessageInput {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  metadata?: unknown;
  createdAt: number;
}

export class SessionMessageRepository {
  constructor(private db: Database) {}

  private mapRow(row: any): StoredSessionMessage {
    return {
      id: row.id,
      sessionId: row.sessionId,
      role: row.role as MessageRole,
      content: row.content,
      metadata: row.metadata ?? null,
      createdAt: row.createdAt,
      offset: row.offset ?? null,
      treeEntryId: row.treeEntryId ?? undefined,
    };
  }

  sessionExists(sessionId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
    return !!row;
  }

  countBySession(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as total FROM messages WHERE session_id = ?')
      .get(sessionId) as { total: number };
    return row.total;
  }

  countUserMessagesBySession(sessionId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as total FROM messages WHERE session_id = ? AND role = 'user'")
      .get(sessionId) as { total: number };
    return row.total;
  }

  listRecentAssistantContents(sessionId: string, limit: number): Array<{ content: string }> {
    return this.db
      .prepare(
        `SELECT content FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT ?`
      )
      .all(sessionId, limit) as Array<{ content: string }>;
  }

  listBySession(sessionId: string, options: SessionMessageListOptions): StoredSessionMessage[] {
    const { limit, before, after, afterOffset, aroundMessageId } = options;

    let query: string;
    let params: Array<string | number>;

    if (aroundMessageId) {
      const target = this.db
        .prepare(
          `
        SELECT offset
        FROM messages
        WHERE session_id = ? AND id = ?
      `
        )
        .get(sessionId, aroundMessageId) as { offset: number } | undefined;

      if (!target) {
        throw new Error(`message not found: ${aroundMessageId}`);
      }

      const beforeCount = Math.floor((limit - 1) / 2);
      const afterCount = limit - beforeCount - 1;
      const minOffset = Math.max(1, target.offset - beforeCount);
      const maxOffset = target.offset + afterCount;

      query = `
        SELECT id, session_id as sessionId, role, content, metadata, created_at as createdAt, offset, tree_entry_id as treeEntryId
        FROM messages
        WHERE session_id = ? AND offset BETWEEN ? AND ?
        ORDER BY offset ASC
      `;
      params = [sessionId, minOffset, maxOffset];
    } else if (afterOffset != null) {
      query = `
        SELECT id, session_id as sessionId, role, content, metadata, created_at as createdAt, offset, tree_entry_id as treeEntryId
        FROM messages
        WHERE session_id = ? AND offset > ?
        ORDER BY offset ASC
        LIMIT ?
      `;
      params = [sessionId, afterOffset, limit];
    } else if (before) {
      query = `
        SELECT id, session_id as sessionId, role, content, metadata, created_at as createdAt, offset, tree_entry_id as treeEntryId
        FROM messages
        WHERE session_id = ? AND created_at < ?
        ORDER BY created_at DESC
        LIMIT ?
      `;
      params = [sessionId, before, limit];
    } else if (after) {
      query = `
        SELECT id, session_id as sessionId, role, content, metadata, created_at as createdAt, offset, tree_entry_id as treeEntryId
        FROM messages
        WHERE session_id = ? AND created_at > ?
        ORDER BY created_at ASC
        LIMIT ?
      `;
      params = [sessionId, after, limit];
    } else {
      query = `
        SELECT id, session_id as sessionId, role, content, metadata, created_at as createdAt, offset, tree_entry_id as treeEntryId
        FROM messages
        WHERE session_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `;
      params = [sessionId, limit];
    }

    const rows = this.db.prepare(query).all(...params);
    return rows.map(row => this.mapRow(row));
  }

  create(input: CreateSessionMessageInput): StoredSessionMessage {
    this.db
      .prepare(
        `
      INSERT INTO messages (id, session_id, role, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        input.id,
        input.sessionId,
        input.role,
        input.content,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.createdAt
      );

    const row = this.db
      .prepare(
        `
      SELECT id, session_id as sessionId, role, content, metadata, created_at as createdAt, offset, tree_entry_id as treeEntryId
      FROM messages
      WHERE id = ?
    `
      )
      .get(input.id);

    if (!row) {
      throw new Error(`failed to create message: ${input.id}`);
    }

    return this.mapRow(row);
  }

  findRowIdById(id: string): number | null {
    const row = this.db.prepare('SELECT rowid FROM messages WHERE id = ?').get(id) as
      | { rowid: number }
      | undefined;
    return row?.rowid ?? null;
  }

  updateSessionTimestamp(sessionId: string, updatedAt: number): void {
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(updatedAt, sessionId);
  }
}
