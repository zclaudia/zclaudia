import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { SessionRepository } from '../repository.js';

function seed(db: Database.Database) {
  db.prepare(`INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at) VALUES ('l1','default','anthropic',1,1)`).run();
  db.prepare(`INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1','p',1,1)`).run();
  db.prepare(`INSERT INTO agent_profiles (id, name, llm_profile_id, created_at, updated_at) VALUES ('a1','a','l1',1,1)`).run();
}

it('SessionRepository persists and maps fork lineage', () => {
  const db = new Database(':memory:');
  applyMigrations(db);
  seed(db);
  const repo = new SessionRepository(db);

  // Create the source session first (FK constraint: forked_from_session_id references sessions.id)
  const src = repo.create({
    projectId: 'p1', agentProfileId: 'a1', type: 'regular',
  } as any);

  const created = repo.create({
    projectId: 'p1', agentProfileId: 'a1', type: 'regular',
    forkedFromSessionId: src.id, forkEntryId: 'e9',
  } as any);
  const read = repo.findById(created.id)!;
  expect(read.forkedFromSessionId).toBe(src.id);
  expect(read.forkEntryId).toBe('e9');
  db.close();
});
