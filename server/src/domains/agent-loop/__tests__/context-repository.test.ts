import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { migration } from '../../../infra/storage/migrations/028_agent_loop_contexts.js';
import { AgentLoopContextRepository } from '../context-repository.js';

describe('AgentLoopContextRepository', () => {
  let db: Database.Database;
  let repo: AgentLoopContextRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(migration.sql);
    repo = new AgentLoopContextRepository(db, { now: () => 1000 });
  });

  it('reuses workflow-thread contexts by owner and key', () => {
    const first = repo.resolveContextForRun({
      owner: { type: 'workflow_run', id: 'run-1' },
      policy: 'workflow-thread',
      key: 'review-thread',
    });
    repo.appendEvent({
      contextId: first.contextId,
      kind: 'artifact',
      payload: { stepId: 'lint', output: 'ok' },
    });

    const second = repo.resolveContextForRun({
      owner: { type: 'workflow_run', id: 'run-1' },
      policy: 'workflow-thread',
      key: 'review-thread',
    });

    expect(second.contextId).toBe(first.contextId);
    expect(second.loadedEvents).toHaveLength(1);
    expect(second.loadedEvents[0]).toMatchObject({
      kind: 'artifact',
      payload: { stepId: 'lint', output: 'ok' },
    });
  });

  it('creates a fresh step-local context for each run and loads no prior events', () => {
    const first = repo.resolveContextForRun({
      owner: { type: 'workflow_run', id: 'run-1' },
      policy: 'step-local',
      key: 'permission:req-1',
    });
    repo.appendEvent({
      contextId: first.contextId,
      kind: 'assistant_message',
      payload: { text: 'old' },
    });

    const second = repo.resolveContextForRun({
      owner: { type: 'workflow_run', id: 'run-1' },
      policy: 'step-local',
      key: 'permission:req-1',
    });

    expect(second.contextId).not.toBe(first.contextId);
    expect(second.loadedEvents).toEqual([]);
  });

  it('records trace events for none policy without loading prior context', () => {
    const resolved = repo.resolveContextForRun({
      owner: { type: 'manual', id: 'manual-1' },
      policy: 'none',
    });

    repo.appendEvent({ contextId: resolved.contextId, kind: 'input', payload: { text: 'hello' } });

    expect(resolved.loadedEvents).toEqual([]);
    expect(repo.loadEvents(resolved.contextId)).toMatchObject([
      { kind: 'input', payload: { text: 'hello' } },
    ]);
  });

  it('loads events in insertion order when timestamps are identical', () => {
    const resolved = repo.resolveContextForRun({
      owner: { type: 'manual', id: 'manual-2' },
      policy: 'none',
    });

    repo.appendEvent({ contextId: resolved.contextId, kind: 'input', payload: { seq: 1 } });
    repo.appendEvent({ contextId: resolved.contextId, kind: 'input', payload: { seq: 2 } });

    expect(repo.loadEvents(resolved.contextId).map(event => event.payload.seq)).toEqual([1, 2]);
  });

  it('loads the latest event window in insertion order', () => {
    const resolved = repo.resolveContextForRun({
      owner: { type: 'workflow_run', id: 'run-2' },
      policy: 'workflow-thread',
      key: 'thread',
    });

    repo.appendEvent({ contextId: resolved.contextId, kind: 'input', payload: { seq: 1 } });
    repo.appendEvent({ contextId: resolved.contextId, kind: 'input', payload: { seq: 2 } });
    repo.appendEvent({ contextId: resolved.contextId, kind: 'input', payload: { seq: 3 } });
    repo.appendEvent({ contextId: resolved.contextId, kind: 'input', payload: { seq: 4 } });

    const replay = repo.resolveContextForRun({
      owner: { type: 'workflow_run', id: 'run-2' },
      policy: 'workflow-thread',
      key: 'thread',
      maxEvents: 2,
    });

    expect(replay.loadedEvents.map(event => event.payload.seq)).toEqual([3, 4]);
  });
});
