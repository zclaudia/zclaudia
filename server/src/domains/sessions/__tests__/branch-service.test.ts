import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import {
  seedEntry,
  seedLane,
} from '../../../infra/providers/pi-runtime/session-tree/__tests__/fixture.js';
import { SqliteSessionStorage } from '../../../infra/providers/pi-runtime/session-tree/sqlite-session-storage.js';
import { branchSessionAt, BranchError } from '../branch-service.js';

function setup() {
  const db = new Database(':memory:');
  applyMigrations(db);
  db.prepare(
    `INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at) VALUES ('l','d','anthropic',1,1)`
  ).run();
  db.prepare(`INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p','p',1,1)`).run();
  db.prepare(
    `INSERT INTO agent_profiles (id, name, llm_profile_id, created_at, updated_at) VALUES ('a','a','l',1,1)`
  ).run();
  db.prepare(
    `INSERT INTO sessions (id, project_id, agent_profile_id, type, created_at, updated_at) VALUES ('s','p','a','regular',1,1)`
  ).run();
  const e = (id: string, parent: string | null, msg: unknown) => {
    seedEntry(db, 's', { id, parentId: parent, type: 'message', message: msg });
  };
  e('e1', null, { role: 'user', content: 'q1' });
  e('e2', 'e1', { role: 'assistant', content: [{ type: 'text', text: 'a1' }] });
  e('e3', 'e2', { role: 'user', content: 'q2' });
  seedLane(db, 's', 'e3');
  return db;
}

it('moves leaf and reprojects messages to the new active path', async () => {
  const db = setup();
  await branchSessionAt(db, 's', 'e1');
  expect(await new SqliteSessionStorage(db, 's').getLeafId()).toBe('e1');
  const rows = db
    .prepare(
      `SELECT content, tree_entry_id AS t FROM messages WHERE session_id='s' ORDER BY offset`
    )
    .all() as Array<{ content: string; t: string }>;
  expect(rows).toEqual([{ content: 'q1', t: 'e1' }]);
  db.close();
});

it('rejects an entry id not in the session', async () => {
  const db = setup();
  await expect(branchSessionAt(db, 's', 'nope')).rejects.toBeInstanceOf(BranchError);
  db.close();
});
