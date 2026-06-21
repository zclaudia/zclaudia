import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { readActivePathRows, writeProjectedMessages } from '../reproject-messages.js';

function insertEntry(db: Database.Database, sessionId: string, id: string, parentId: string | null, message: unknown) {
  db.prepare(`INSERT INTO session_entries (id, session_id, parent_id, type, payload, timestamp) VALUES (?, ?, ?, 'message', ?, ?)`)
    .run(id, sessionId, parentId, JSON.stringify({ message }), new Date().toISOString());
  db.prepare(`INSERT INTO session_leaf (session_id, leaf_id) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET leaf_id = excluded.leaf_id`)
    .run(sessionId, id);
}

async function reproject(db: Database.Database, sessionId: string) {
  const rows = await readActivePathRows(db, sessionId);
  db.transaction(() => writeProjectedMessages(db, sessionId, rows))();
}

function seedSession(db: Database.Database) {
  db.prepare(`INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at) VALUES ('l','d','anthropic',1,1)`).run();
  db.prepare(`INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p','p',1,1)`).run();
  db.prepare(`INSERT INTO agent_profiles (id, name, llm_profile_id, created_at, updated_at) VALUES ('a','a','l',1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, project_id, agent_profile_id, type, created_at, updated_at) VALUES ('s','p','a','regular',1,1)`).run();
}

it('rebuilds messages rows from the active path with offsets + tree_entry_id', async () => {
  const db = new Database(':memory:');
  applyMigrations(db);
  seedSession(db);
  insertEntry(db, 's', 'e1', null, { role: 'user', content: 'hello' });
  insertEntry(db, 's', 'e2', 'e1', { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] });

  await reproject(db, 's');

  const rows = db.prepare(`SELECT role, content, offset, tree_entry_id AS t FROM messages WHERE session_id = 's' ORDER BY offset ASC`).all() as Array<{ role: string; content: string; offset: number; t: string }>;
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ role: 'user', content: 'hello', offset: 1, t: 'e1' });
  expect(rows[1]).toMatchObject({ role: 'assistant', content: 'hi there', offset: 2, t: 'e2' });
  db.close();
});

it('clears prior messages before reprojecting (branch rewrite)', async () => {
  const db = new Database(':memory:');
  applyMigrations(db);
  seedSession(db);
  db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at, offset) VALUES ('stale','s','user','OLD',1,1)`).run();
  insertEntry(db, 's', 'e1', null, { role: 'user', content: 'fresh' });

  await reproject(db, 's');

  const ids = db.prepare(`SELECT id FROM messages WHERE session_id='s'`).all() as Array<{ id: string }>;
  expect(ids.find((r) => r.id === 'stale')).toBeUndefined();
  db.close();
});
