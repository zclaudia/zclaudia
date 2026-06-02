import type { Database } from 'better-sqlite3';

export interface SessionCompaction {
  id: string;
  sessionId: string;
  summary: string;
  firstKeptMessageId: string;
  tokensBefore: number;
  details: { readFiles: string[]; modifiedFiles: string[] } | null;
  source: 'auto' | 'manual';
  customInstructions: string | null;
  createdAt: number;
}

export interface CreateSessionCompactionInput {
  id: string;
  sessionId: string;
  summary: string;
  firstKeptMessageId: string;
  tokensBefore: number;
  details?: { readFiles: string[]; modifiedFiles: string[] };
  source: 'auto' | 'manual';
  customInstructions?: string;
  createdAt: number;
}

export class SessionCompactionRepository {
  constructor(private db: Database) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapRow(row: any): SessionCompaction {
    return {
      id: row.id,
      sessionId: row.session_id,
      summary: row.summary,
      firstKeptMessageId: row.first_kept_message_id,
      tokensBefore: row.tokens_before,
      details: row.details ? JSON.parse(row.details) : null,
      source: row.source as 'auto' | 'manual',
      customInstructions: row.custom_instructions ?? null,
      createdAt: row.created_at,
    };
  }

  create(input: CreateSessionCompactionInput): SessionCompaction {
    this.db.prepare(`
      INSERT INTO session_compactions
        (id, session_id, summary, first_kept_message_id, tokens_before,
         details, source, custom_instructions, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id, input.sessionId, input.summary, input.firstKeptMessageId, input.tokensBefore,
      input.details ? JSON.stringify(input.details) : null,
      input.source,
      input.customInstructions ?? null,
      input.createdAt,
    );
    const row = this.db.prepare('SELECT * FROM session_compactions WHERE id = ?').get(input.id);
    return this.mapRow(row);
  }

  getLatest(sessionId: string): SessionCompaction | null {
    const row = this.db.prepare(
      `SELECT * FROM session_compactions WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`,
    ).get(sessionId);
    return row ? this.mapRow(row) : null;
  }

  list(sessionId: string): SessionCompaction[] {
    const rows = this.db.prepare(
      `SELECT * FROM session_compactions WHERE session_id = ? ORDER BY created_at ASC`,
    ).all(sessionId);
    return rows.map((r) => this.mapRow(r));
  }
}
