import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../repository.js';

describe('TaskRepository.listByTypeAndStatuses', () => {
  let db: Database.Database;
  let repo: TaskRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    repo = new TaskRepository(db);
  });

  it('filters by type, status set, and optionally sessionId', () => {
    const a = repo.create({ type: 'command', sessionId: 's1', metadata: { command: 'sleep 1' } });
    repo.update(a.id, { status: 'running' });
    const b = repo.create({ type: 'command', sessionId: 's2', metadata: { command: 'sleep 1' } });
    repo.update(b.id, { status: 'running' });
    const c = repo.create({ type: 'command', sessionId: 's1' });
    repo.update(c.id, { status: 'completed' });
    const d = repo.create({ type: 'agent', sessionId: 's1' });
    repo.update(d.id, { status: 'running' });

    const all = repo.listByTypeAndStatuses('command', ['running', 'queued']);
    expect(all.map(t => t.id).sort()).toEqual([a.id, b.id].sort());

    const s1 = repo.listByTypeAndStatuses('command', ['running'], 's1');
    expect(s1.map(t => t.id)).toEqual([a.id]);

    expect(repo.listByTypeAndStatuses('command', [])).toEqual([]);
  });
});
