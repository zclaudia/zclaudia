import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { branchSessionAt, BranchError } from '../branch-service.js';

function setup() {
  const db = new Database(':memory:');
  applyMigrations(db);
  db.prepare(`INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at) VALUES ('l','d','anthropic',1,1)`).run();
  db.prepare(`INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p','p',1,1)`).run();
  db.prepare(`INSERT INTO agent_profiles (id, name, llm_profile_id, created_at, updated_at) VALUES ('a','a','l',1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, project_id, agent_profile_id, type, created_at, updated_at) VALUES ('s','p','a','regular',1,1)`).run();
  const e = (id: string, parent: string | null, msg: unknown) => {
    db.prepare(`INSERT INTO session_entries (id, session_id, parent_id, type, payload, timestamp) VALUES (?, 's', ?, 'message', ?, ?)`)
      .run(id, parent, JSON.stringify({ message: msg }), new Date().toISOString());
  };
  e('e1', null, { role: 'user', content: 'q1' });
  e('e2', 'e1', { role: 'assistant', content: [{ type: 'text', text: 'a1' }] });
  e('e3', 'e2', { role: 'user', content: 'q2' });
  db.prepare(`INSERT INTO session_leaf (session_id, leaf_id) VALUES ('s','e3')`).run();
  return db;
}

it('moves leaf and reprojects messages to the new active path', async () => {
  const db = setup();
  await branchSessionAt(db, 's', 'e1');
  const leaf = db.prepare(`SELECT leaf_id AS l FROM session_leaf WHERE session_id='s'`).get() as { l: string };
  expect(leaf.l).toBe('e1');
  const rows = db.prepare(`SELECT content, tree_entry_id AS t FROM messages WHERE session_id='s' ORDER BY offset`).all() as Array<{ content: string; t: string }>;
  expect(rows).toEqual([{ content: 'q1', t: 'e1' }]);
  db.close();
});

it('rejects an entry id not in the session', async () => {
  const db = setup();
  await expect(branchSessionAt(db, 's', 'nope')).rejects.toBeInstanceOf(BranchError);
  db.close();
});
