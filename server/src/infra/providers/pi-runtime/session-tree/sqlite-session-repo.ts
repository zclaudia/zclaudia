import type { Database } from 'better-sqlite3';
import {
  Session,
  SessionError,
  type ForkOptions,
  type SessionCreateOptions,
  type SessionMetadata,
  type SessionRepo,
} from '@earendil-works/pi-agent-core';
import { newId } from '../../../../utils/uuid.js';
import { SqliteSessionStorage } from './sqlite-session-storage.js';

/**
 * pi `SessionRepo` over the same tables `SqliteSessionStorage` writes.
 *
 * zclaudia does not route its own session lifecycle through this — sessions are
 * created by the app with a project, an agent profile and everything else the
 * `sessions` row carries. It exists so pi's session-backend conformance suite
 * can drive our storage the way it drives pi's own, which is the only way to
 * check a hand-ported `SessionState` against the semantics it was ported from.
 */
export class SqliteSessionRepo implements SessionRepo {
  constructor(private db: Database) {}

  async create(options: SessionCreateOptions = {}): Promise<Session> {
    const id = options.id ?? newId();
    const exists = this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id);
    if (exists) throw new SessionError('already_exists', `Session already exists: ${id}`);
    this.db
      .prepare('INSERT INTO sessions (id, created_at, parent_session_id) VALUES (?, ?, ?)')
      .run(id, Date.now(), options.parentSessionId ?? null);
    return new Session(new SqliteSessionStorage(this.db, id));
  }

  async open(metadata: SessionMetadata): Promise<Session> {
    this.require(metadata.id);
    return new Session(new SqliteSessionStorage(this.db, metadata.id));
  }

  async list(): Promise<SessionMetadata[]> {
    const rows = this.db
      .prepare(
        'SELECT id, created_at AS createdAt, parent_session_id AS parentSessionId FROM sessions ORDER BY created_at ASC, id ASC'
      )
      .all() as Array<{ id: string; createdAt: number; parentSessionId: string | null }>;
    return rows.map(row => ({
      id: row.id,
      createdAt: row.createdAt,
      ...(row.parentSessionId ? { parentSessionId: row.parentSessionId } : {}),
    }));
  }

  /** Idempotent: deleting a session that is already gone is not an error. */
  async delete(metadata: SessionMetadata): Promise<void> {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM session_log WHERE session_id = ?').run(metadata.id);
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(metadata.id);
    })();
  }

  async fork(
    source: SessionMetadata,
    options: ForkOptions & SessionCreateOptions
  ): Promise<Session> {
    this.require(source.id);
    const id = options.id ?? newId();
    if (this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id)) {
      throw new SessionError('already_exists', `Session already exists: ${id}`);
    }
    // The copy is computed before the row is written so an invalid fork target
    // leaves no half-made session behind.
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO sessions (id, created_at, parent_session_id) VALUES (?, ?, ?)')
        .run(id, Date.now(), options.parentSessionId ?? source.id);
      new SqliteSessionStorage(this.db, source.id).forkInto(id, options);
    })();
    return new Session(new SqliteSessionStorage(this.db, id));
  }

  private require(id: string): void {
    if (!this.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id)) {
      throw new SessionError('not_found', `Session not found: ${id}`);
    }
  }
}
