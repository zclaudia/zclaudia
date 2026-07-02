import type Database from 'better-sqlite3';
import type { TranscriptPort } from '../coordinator.js';
import type { TranscriptMessage } from '../evaluator.js';

interface MessageRow {
  role: string;
  content: string;
  created_at: number;
}

export class SqliteTranscriptPort implements TranscriptPort {
  constructor(private readonly db: Database.Database) {}

  async read(sessionId: string, lookback: number): Promise<TranscriptMessage[]> {
    const rows = this.db
      .prepare(
        `SELECT role, content, created_at
         FROM messages
         WHERE session_id = ?
         ORDER BY offset DESC
         LIMIT ?`
      )
      .all(sessionId, lookback) as MessageRow[];
    return rows.reverse().map(r => ({
      role: (r.role as TranscriptMessage['role']) ?? 'user',
      content: r.content ?? '',
      timestamp: r.created_at,
    }));
  }
}
