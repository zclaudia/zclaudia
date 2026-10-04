import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../../../../domains/tasks/repository.js';
import { TaskService } from '../../../../domains/tasks/task-service.js';
import { clearSession, trackAndAutoComplete } from '../../interactions/todo-state-tracker.js';
import { createPiToolLookups } from '../pi-tool-lookups.js';

function seedProfile(db: Database.Database, id: string, name: string, status: string) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO agent_profiles (id, name, description, runtime_type, llm_profile_id, system_prompt, enabled_tools, is_default, status, source, created_at, updated_at)
     VALUES (?, ?, ?, 'pi', NULL, '', '[]', 0, ?, 'user', ?, ?)`
  ).run(id, name, `  ${name} profile  `, status, now, now);
}

describe('createPiToolLookups', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
  });

  afterEach(() => db.close());

  it('lists only active agent profiles with trimmed descriptions', () => {
    seedProfile(db, 'prof-explore', 'Explore', 'active');
    seedProfile(db, 'prof-old', 'Legacy', 'readonly');
    expect(createPiToolLookups(db).listSubagentTypes()).toContainEqual({
      id: 'prof-explore',
      name: 'Explore',
      description: 'Explore profile',
    });
    expect(
      createPiToolLookups(db)
        .listSubagentTypes()
        .map(entry => entry.id)
    ).not.toContain('prof-old');
  });

  it('detects sessions launched by an Agent task', () => {
    const service = new TaskService(new TaskRepository(db));
    const child = service.createTask({
      type: 'agent',
      title: 'child',
      parentSessionId: 'parent',
      metadata: { prompt: 'p' },
    });
    service.startTask(child.id, { sessionId: 'child-1' });
    const lookups = createPiToolLookups(db);
    expect(lookups.isSubagentSession('child-1')).toBe(true);
    expect(lookups.isSubagentSession('parent')).toBe(false);
  });

  it('finds sessions by id and returns undefined for unknown ones', () => {
    const now = Date.now();
    seedProfile(db, 'prof', 'Default', 'active');
    db.prepare(
      `INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES ('proj', 'proj', '/tmp/proj', ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO sessions (id, project_id, agent_profile_id, name, type, created_at, updated_at)
       VALUES ('s1', 'proj', 'prof', 'One', 'regular', ?, ?)`
    ).run(now, now);
    const lookups = createPiToolLookups(db);
    expect(lookups.findSession('s1')).toMatchObject({ projectId: 'proj', name: 'One' });
    expect(lookups.findSession('missing')).toBeUndefined();
  });

  it('reads the latest tracked todo list', () => {
    clearSession('lookup-todos');
    trackAndAutoComplete('lookup-todos', 'i1', [{ content: 'A', status: 'pending' }] as never);
    expect(createPiToolLookups(db).getLatestTodos('lookup-todos')).toEqual([
      { content: 'A', status: 'pending' },
    ]);
    clearSession('lookup-todos');
  });
});
