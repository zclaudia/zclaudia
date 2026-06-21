import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { forkSession, ForkError } from '../fork-service.js';

function setup() {
  const db = new Database(':memory:');
  applyMigrations(db);
  db.prepare(`INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at) VALUES ('l','d','anthropic',1,1)`).run();
  db.prepare(`INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p','p',1,1)`).run();
  db.prepare(`INSERT INTO agent_profiles (id, name, llm_profile_id, created_at, updated_at) VALUES ('a','a','l',1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, project_id, name, agent_profile_id, type, working_directory, created_at, updated_at) VALUES ('s','p','Orig','a','regular','/tmp',1,1)`).run();
  const e = (id: string, parent: string | null, msg: unknown) =>
    db.prepare(`INSERT INTO session_entries (id, session_id, parent_id, type, payload, timestamp) VALUES (?, 's', ?, 'message', ?, ?)`)
      .run(id, parent, JSON.stringify({ message: msg }), new Date().toISOString());
  e('e1', null, { role: 'user', content: 'q1' });
  e('e2', 'e1', { role: 'assistant', content: [{ type: 'text', text: 'a1' }] });
  e('e3', 'e2', { role: 'user', content: 'q2' });
  db.prepare(`INSERT INTO session_leaf (session_id, leaf_id) VALUES ('s','e3')`).run();
  return db;
}

it('creates a new session with lineage, copied entries, projection, and leaf', async () => {
  const db = setup();
  const broadcasts: Array<{ type: string; id: string }> = [];
  const session = await forkSession(db, { sourceSessionId: 's', treeEntryId: 'e2' }, {
    broadcastSessionEvent: (type, s) => broadcasts.push({ type, id: s.id }),
  });

  expect(session.forkedFromSessionId).toBe('s');
  expect(session.forkEntryId).toBe('e2');
  expect(session.name).toBe('Orig (fork)');
  expect(session.workingDirectory).toBe('/tmp');

  const leaf = db.prepare(`SELECT leaf_id AS l FROM session_leaf WHERE session_id=?`).get(session.id) as { l: string };
  expect(leaf.l).toBe('e2');

  const entries = db.prepare(`SELECT id FROM session_entries WHERE session_id=? ORDER BY id`).all(session.id) as Array<{ id: string }>;
  expect(entries.map((x) => x.id).sort()).toEqual(['e1', 'e2']);

  const msgs = db.prepare(`SELECT content, tree_entry_id AS t FROM messages WHERE session_id=? ORDER BY offset`).all(session.id) as Array<{ content: string; t: string }>;
  expect(msgs).toEqual([{ content: 'q1', t: 'e1' }, { content: 'a1', t: 'e2' }]);

  expect(broadcasts).toEqual([{ type: 'created', id: session.id }]);
  db.close();
});

it('uses a custom name when provided, falls back when blank', async () => {
  const db = setup();
  const named = await forkSession(db, { sourceSessionId: 's', treeEntryId: 'e1', name: 'My Fork' }, {});
  expect(named.name).toBe('My Fork');
  const blank = await forkSession(db, { sourceSessionId: 's', treeEntryId: 'e1', name: '   ' }, {});
  expect(blank.name).toBe('Orig (fork)');
  db.close();
});

it('rejects an entry not in the source session', async () => {
  const db = setup();
  await expect(forkSession(db, { sourceSessionId: 's', treeEntryId: 'nope' }, {})).rejects.toBeInstanceOf(ForkError);
  db.close();
});
