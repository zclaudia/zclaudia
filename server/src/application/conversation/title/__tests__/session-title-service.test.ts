import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { maybeGenerateSessionTitle } from '../session-title-service.js';

function makeDb(type = 'regular'): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT,
      agent_profile_id TEXT NOT NULL DEFAULT 'a', sdk_session_id TEXT, type TEXT,
      parent_session_id TEXT, working_directory TEXT, sort_order INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER,
      project_role TEXT, task_id TEXT, plan_status TEXT, is_read_only INTEGER,
      last_run_status TEXT, auto_title TEXT, auto_title_msg_count INTEGER
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, metadata TEXT, created_at INTEGER NOT NULL, offset INTEGER
    );
    INSERT INTO sessions (id, project_id, agent_profile_id, type, created_at, updated_at)
      VALUES ('s1','p1','a','${type}',100,100);
    INSERT INTO messages (id, session_id, role, content, created_at)
      VALUES ('m1','s1','user','what is this project',1);
  `);
  return db;
}

const deps = (db: Database.Database, over: Partial<Parameters<typeof maybeGenerateSessionTitle>[0]> = {}) => ({
  db,
  sessionId: 's1',
  agentProfile: { model: 'test-model' } as any,
  llmProfile: { apiKey: 'k' } as any,
  broadcast: vi.fn(),
  generate: vi.fn().mockResolvedValue('Project Overview'),
  ...over,
});

// maybeGenerateSessionTitle is fire-and-forget; flush microtasks before asserting.
const flush = () => new Promise((r) => setImmediate(r));

describe('maybeGenerateSessionTitle', () => {
  let db: Database.Database;
  beforeEach(() => { db = makeDb(); });

  it('persists the title and broadcasts sessions_updated on first message', async () => {
    const d = deps(db);
    maybeGenerateSessionTitle(d);
    await flush();
    const row = db.prepare('SELECT auto_title, auto_title_msg_count FROM sessions WHERE id = ?').get('s1') as any;
    expect(row.auto_title).toBe('Project Overview');
    expect(row.auto_title_msg_count).toBe(1);
    expect(d.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sessions_updated', session: expect.objectContaining({ id: 's1', autoTitle: 'Project Overview' }) }),
    );
  });

  it('skips background sessions', async () => {
    const bgDb = makeDb('background');
    const d = deps(bgDb);
    maybeGenerateSessionTitle(d);
    await flush();
    expect(d.generate).not.toHaveBeenCalled();
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it('does not regenerate before the threshold delta', async () => {
    db.prepare("UPDATE sessions SET auto_title = 'Old', auto_title_msg_count = 1 WHERE id = 's1'").run();
    const d = deps(db); // still 1 user message → delta 0 < 3
    maybeGenerateSessionTitle(d);
    await flush();
    expect(d.generate).not.toHaveBeenCalled();
  });

  it('does not start a second generation while one is in flight', async () => {
    let resolveGen: (v: string) => void = () => {};
    const generate = vi.fn(() => new Promise<string>((r) => { resolveGen = r; }));
    const d = deps(db, { generate });
    maybeGenerateSessionTitle(d);  // first call: runs synchronously until the generate() await, marking in-flight
    await flush();
    maybeGenerateSessionTitle(d);  // second call: should be skipped while in-flight
    await flush();
    expect(generate).toHaveBeenCalledTimes(1);
    resolveGen('Some Title');       // let the first finish so in-flight is cleared
    await flush();
  });

  it('swallows generator errors and leaves the prior value intact', async () => {
    db.prepare("UPDATE sessions SET auto_title = 'Keep', auto_title_msg_count = 0 WHERE id = 's1'").run();
    const d = deps(db, { generate: vi.fn().mockRejectedValue(new Error('boom')) });
    expect(() => maybeGenerateSessionTitle(d)).not.toThrow();
    await flush();
    const row = db.prepare('SELECT auto_title FROM sessions WHERE id = ?').get('s1') as any;
    expect(row.auto_title).toBe('Keep');
    expect(d.broadcast).not.toHaveBeenCalled();
  });
});
