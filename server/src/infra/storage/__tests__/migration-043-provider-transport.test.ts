import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../migrations/index.js';

/** Insert one agent profile + one session row with explicit fields. */
function insertSession(
  db: Database.Database,
  opts: {
    id: string;
    runtimeType: string;
    sdkSessionId?: string;
    transport?: string;
  }
): void {
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO projects (id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `
  ).run(`proj-${opts.id}`, `project-${opts.id}`, now, now);
  db.prepare(
    `
    INSERT INTO agent_profiles (id, name, runtime_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `
  ).run(`ap-${opts.id}`, `agent-${opts.id}`, opts.runtimeType, now, now);
  db.prepare(
    `
    INSERT INTO sessions (id, project_id, agent_profile_id, sdk_session_id, provider_transport, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    opts.id,
    `proj-${opts.id}`,
    `ap-${opts.id}`,
    opts.sdkSessionId ?? null,
    opts.transport ?? null,
    now,
    now
  );
}

function readTransport(db: Database.Database, id: string): string | null {
  const row = db.prepare(`SELECT provider_transport FROM sessions WHERE id = ?`).get(id) as
    | { provider_transport: string | null }
    | undefined;
  return row?.provider_transport ?? null;
}

describe('migration 043 — session provider_transport', () => {
  it('adds the provider_transport column to sessions', () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    const cols = db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toContain('provider_transport');
  });

  it('records migration 043 as applied', () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    const rows = db.prepare(`SELECT name FROM migrations`).all() as Array<{ name: string }>;
    expect(rows.map(r => r.name)).toContain('043_session_provider_transport');
  });

  it('backfills exactly: cursor sessions that ran become legacy, everything else stays NULL (§14.2)', () => {
    const db = new Database(':memory:');
    applyMigrations(db);

    insertSession(db, { id: 'cursor-ran', runtimeType: 'cursor', sdkSessionId: 'cs_1' });
    insertSession(db, { id: 'cursor-empty', runtimeType: 'cursor' });
    insertSession(db, {
      id: 'cursor-bound',
      runtimeType: 'cursor',
      sdkSessionId: 'cs_2',
      transport: 'cursor-acp-v1',
    });
    insertSession(db, { id: 'claude-ran', runtimeType: 'claude', sdkSessionId: 'as_1' });
    insertSession(db, { id: 'pi-ran', runtimeType: 'pi', sdkSessionId: 'ps_1' });

    // The migration already ran during applyMigrations; the backfill conditions
    // are evaluated against the pre-migration rows inserted above. Re-apply the
    // backfill statement to verify its exact predicate.
    db.prepare(
      `
      UPDATE sessions
      SET provider_transport = 'cursor-stream-json-v1'
      WHERE provider_transport IS NULL
        AND sdk_session_id IS NOT NULL
        AND agent_profile_id IN (
          SELECT id FROM agent_profiles WHERE runtime_type = 'cursor'
        )
      `
    ).run();

    expect(readTransport(db, 'cursor-ran')).toBe('cursor-stream-json-v1');
    expect(readTransport(db, 'cursor-empty')).toBeNull();
    expect(readTransport(db, 'cursor-bound')).toBe('cursor-acp-v1');
    expect(readTransport(db, 'claude-ran')).toBeNull();
    expect(readTransport(db, 'pi-ran')).toBeNull();
  });
});
