import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { WorkflowRunRepository } from '../workflow-run-repository.js';

describe('WorkflowRunRepository (generalized)', () => {
  let db: Database.Database;
  let repo: WorkflowRunRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    repo = new WorkflowRunRepository(db);
  });

  it('persists and reads initiator/action fields for an activity run', () => {
    const run = repo.create({
      workflowId: undefined,
      projectId: undefined,
      status: 'running',
      triggerSource: 'schedule',
      initiator: 'automation:a1',
      actionKind: 'activity',
      actionRef: 'git_commit',
      startedAt: 1,
    });
    const found = repo.findById(run.id)!;
    expect(found.workflowId).toBeUndefined();
    expect(found.initiator).toBe('automation:a1');
    expect(found.actionKind).toBe('activity');
    expect(found.actionRef).toBe('git_commit');
  });

  it('finds runs by initiator', () => {
    repo.create({
      status: 'running',
      triggerSource: 'manual',
      initiator: 'automation:a1',
      startedAt: 1,
    });
    repo.create({
      status: 'running',
      triggerSource: 'manual',
      initiator: 'automation:a2',
      startedAt: 2,
    });
    expect(repo.findByInitiator('automation:a1')).toHaveLength(1);
  });
});
