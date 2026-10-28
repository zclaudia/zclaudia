import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { maybeGenerateSessionTitle } from '../session-title-service.js';
import {
  setSessionEventPublisher,
  getSessionEventPublisher,
} from '../../../../domains/sessions/session-event-port.js';

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

const deps = (
  db: Database.Database,
  over: Partial<Parameters<typeof maybeGenerateSessionTitle>[0]> = {}
) => ({
  db,
  sessionId: 's1',
  agentProfile: { model: 'test-model' } as any,
  llmProfile: { apiKey: 'k' } as any,
  broadcast: vi.fn(),
  generate: vi.fn().mockResolvedValue('Project Overview'),
  ...over,
});

// maybeGenerateSessionTitle is fire-and-forget; flush microtasks before asserting.
const flush = () => new Promise(r => setImmediate(r));

function setAutoTitleConfig(db: Database.Database, enabled: number, model: string | null): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_title_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      enabled INTEGER NOT NULL DEFAULT 1,
      model TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.prepare('DELETE FROM auto_title_config').run();
  db.prepare(
    'INSERT INTO auto_title_config (id, enabled, model, created_at, updated_at) VALUES (1, ?, ?, 1, 1)'
  ).run(enabled, model);
}

describe('maybeGenerateSessionTitle', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
  });
  afterEach(() => {
    // The publisher registry is module-global; never leak a spy across tests.
    setSessionEventPublisher(null);
    expect(getSessionEventPublisher()).toBeNull();
  });

  it('persists the title and broadcasts sessions_updated on first message', async () => {
    const d = deps(db);
    maybeGenerateSessionTitle(d);
    await flush();
    const row = db
      .prepare('SELECT name, auto_title, auto_title_msg_count FROM sessions WHERE id = ?')
      .get('s1') as any;
    expect(row.auto_title).toBe('Project Overview');
    expect(row.auto_title_msg_count).toBe(1);
    expect(row.name).toBe('Project Overview'); // write-through to the unnamed session
    expect(d.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sessions_updated',
        session: expect.objectContaining({ id: 's1', autoTitle: 'Project Overview' }),
      })
    );
  });

  it('publishes the landed session resource event so resource-only peers sync', async () => {
    const publishSessionEvent = vi.fn();
    setSessionEventPublisher({ publishSessionEvent });
    maybeGenerateSessionTitle(deps(db));
    await flush();
    expect(publishSessionEvent).toHaveBeenCalledWith(
      'updated',
      expect.objectContaining({ id: 's1', name: 'Project Overview', autoTitle: 'Project Overview' })
    );
  });

  it('does not publish a resource event when generation fails', async () => {
    const publishSessionEvent = vi.fn();
    setSessionEventPublisher({ publishSessionEvent });
    maybeGenerateSessionTitle(deps(db, { generate: vi.fn().mockRejectedValue(new Error('boom')) }));
    await flush();
    expect(publishSessionEvent).not.toHaveBeenCalled();
  });

  it('skips generation entirely for a manually named session', async () => {
    db.prepare("UPDATE sessions SET name = 'Manual' WHERE id = 's1'").run();
    const d = deps(db);
    maybeGenerateSessionTitle(d);
    await flush();
    expect(d.generate).not.toHaveBeenCalled();
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it('regenerates the written-through name as the conversation moves on', async () => {
    db.prepare(
      "UPDATE sessions SET name = 'Old', auto_title = 'Old', auto_title_msg_count = 1 WHERE id = 's1'"
    ).run();
    db.exec(`
      INSERT INTO messages (id, session_id, role, content, created_at) VALUES
        ('m2','s1','user','second',2), ('m3','s1','user','third',3), ('m4','s1','user','fourth',4);
    `);
    const d = deps(db); // 4 user messages − 1 counted = 3 ≥ threshold
    maybeGenerateSessionTitle(d);
    await flush();
    expect(d.generate).toHaveBeenCalledTimes(1);
    const row = db.prepare('SELECT name, auto_title FROM sessions WHERE id = ?').get('s1') as any;
    expect(row.name).toBe('Project Overview');
    expect(row.auto_title).toBe('Project Overview');
  });

  it('broadcasts pending=true before generating and pending=false with the title after', async () => {
    const d = deps(db);
    maybeGenerateSessionTitle(d);
    await flush();
    const calls = d.broadcast.mock.calls.map((([msg]) => msg) as unknown as Array<any>);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      type: 'sessions_updated',
      session: { id: 's1', autoTitlePending: true },
    });
    expect(calls[0].session.autoTitle).toBeUndefined();
    expect(calls[1]).toMatchObject({
      type: 'sessions_updated',
      session: { id: 's1', autoTitle: 'Project Overview', autoTitlePending: false },
    });
    // Success clears any prior failure marker (built from the persisted row).
    expect(calls[1].session.autoTitleError).toBeUndefined();
  });

  it('clears pending and stays untitled when the generator rejects', async () => {
    const d = deps(db, { generate: vi.fn().mockRejectedValue(new Error('boom')) });
    expect(() => maybeGenerateSessionTitle(d)).not.toThrow();
    await flush();
    const row = db.prepare('SELECT auto_title FROM sessions WHERE id = ?').get('s1') as any;
    expect(row.auto_title).toBeNull();
    const calls = d.broadcast.mock.calls.map((([msg]) => msg) as unknown as Array<any>);
    expect(calls.at(-1)).toMatchObject({ session: { id: 's1', autoTitlePending: false } });
  });

  it('clears pending when the generator yields no title', async () => {
    const d = deps(db, { generate: vi.fn().mockResolvedValue(null) });
    maybeGenerateSessionTitle(d);
    await flush();
    const row = db.prepare('SELECT auto_title FROM sessions WHERE id = ?').get('s1') as any;
    expect(row.auto_title).toBeNull();
    const calls = d.broadcast.mock.calls.map((([msg]) => msg) as unknown as Array<any>);
    expect(calls.at(-1)).toMatchObject({ session: { id: 's1', autoTitlePending: false } });
  });

  it('broadcasts the post-generation row so concurrent renames are not clobbered', async () => {
    let resolveGen!: (v: string) => void;
    const generate = vi.fn(
      () =>
        new Promise<string>(r => {
          resolveGen = r;
        })
    );
    const d = deps(db, { generate });
    maybeGenerateSessionTitle(d);
    await flush();
    db.prepare("UPDATE sessions SET name = 'Renamed' WHERE id = 's1'").run();
    resolveGen('Project Overview');
    await flush();
    const last = (d.broadcast.mock.calls.at(-1) as unknown as Array<any>)[0];
    expect(last.session.name).toBe('Renamed');
    expect(last.session.autoTitle).toBe('Project Overview');
    // The write-through must also yield to the concurrent rename in the row.
    const row = db.prepare('SELECT name FROM sessions WHERE id = ?').get('s1') as any;
    expect(row.name).toBe('Renamed');
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
    db.prepare(
      "UPDATE sessions SET auto_title = 'Old', auto_title_msg_count = 1 WHERE id = 's1'"
    ).run();
    const d = deps(db); // still 1 user message → delta 0 < 3
    maybeGenerateSessionTitle(d);
    await flush();
    expect(d.generate).not.toHaveBeenCalled();
  });

  it('does not start a second generation while one is in flight', async () => {
    let resolveGen: (v: string) => void = () => {};
    const generate = vi.fn(
      () =>
        new Promise<string>(r => {
          resolveGen = r;
        })
    );
    const d = deps(db, { generate });
    maybeGenerateSessionTitle(d); // first call: runs synchronously until the generate() await, marking in-flight
    await flush();
    maybeGenerateSessionTitle(d); // second call: should be skipped while in-flight
    await flush();
    expect(generate).toHaveBeenCalledTimes(1);
    resolveGen('Some Title'); // let the first finish so in-flight is cleared
    await flush();
  });

  it('does not generate or broadcast when disabled in auto_title_config', async () => {
    setAutoTitleConfig(db, 0, null);
    const d = deps(db);
    maybeGenerateSessionTitle(d);
    await flush();
    expect(d.generate).not.toHaveBeenCalled();
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it('passes the configured model override to the generator', async () => {
    setAutoTitleConfig(db, 1, 'cheap-model');
    const d = deps(db);
    maybeGenerateSessionTitle(d);
    await flush();
    expect(d.generate).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', modelOverride: 'cheap-model' })
    );
  });

  it('broadcasts the failure reason on the closing update', async () => {
    const d = deps(db, { generate: vi.fn().mockRejectedValue(new Error('boom')) });
    maybeGenerateSessionTitle(d);
    await flush();
    const calls = d.broadcast.mock.calls.map((([msg]) => msg) as unknown as Array<any>);
    expect(calls.at(-1)).toMatchObject({
      session: { id: 's1', autoTitlePending: false, autoTitleError: 'boom' },
    });
  });

  it('reports a null title as a no-result failure', async () => {
    const d = deps(db, { generate: vi.fn().mockResolvedValue(null) });
    maybeGenerateSessionTitle(d);
    await flush();
    const calls = d.broadcast.mock.calls.map((([msg]) => msg) as unknown as Array<any>);
    expect(calls.at(-1).session.autoTitleError).toBe('title generation returned no result');
  });

  it('swallows generator errors and leaves the prior value intact', async () => {
    db.prepare(
      "UPDATE sessions SET auto_title = 'Keep', auto_title_msg_count = 0 WHERE id = 's1'"
    ).run();
    const d = deps(db, { generate: vi.fn().mockRejectedValue(new Error('boom')) });
    expect(() => maybeGenerateSessionTitle(d)).not.toThrow();
    await flush();
    const row = db.prepare('SELECT auto_title FROM sessions WHERE id = ?').get('s1') as any;
    expect(row.auto_title).toBe('Keep');
    expect(d.broadcast).not.toHaveBeenCalled();
  });
});
