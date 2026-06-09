import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentTaskRunner } from '../agent-task-runner.js';
import type { AgentRunnerTask } from '../agent-task-runner.js';

function makeTask(overrides: Partial<AgentRunnerTask> = {}): AgentRunnerTask {
  return {
    id: 'task-1',
    parentTaskId: null,
    rootTaskId: null,
    projectId: 'project-1',
    sessionId: null,
    branchId: null,
    contextTemplate: 'review',
    status: 'queued',
    task: 'Review latest diff',
    externalId: null,
    initiator: 'system',
    retryCount: 0,
    maxRetries: 0,
    createdAt: 1,
    updatedAt: 1,
    permissionOverride: { profile: { fileWrite: 'ask' } },
    llmProfileId: 'profile-1',
    ...overrides,
  };
}

describe('AgentTaskRunner', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE claudia_branches (
        id TEXT PRIMARY KEY,
        host_project_id TEXT NOT NULL,
        active_session_id TEXT,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_task_id TEXT
      );
    `);
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('starts an agent run and reports stream, tool count, and completion', async () => {
    const clients = new Map<string, any>();
    const onStarted = vi.fn();
    const onDelta = vi.fn();
    const onCompleted = vi.fn();
    const handleRunStart = vi.fn(async (client: any) => {
      client.ws.send({ type: 'delta', content: 'Hello ' });
      client.ws.send({ type: 'tool_use' });
      client.ws.send({ type: 'delta', content: 'world' });
      client.ws.send({ type: 'run_completed' });
    });
    const runner = createAgentTaskRunner({
      db,
      createVirtualClient: (clientId, ws) => ({ id: clientId, ws }),
      handleRunStart,
      getClients: () => clients,
      createSession: vi.fn(() => ({ id: 'session-1' })),
      sessionExists: vi.fn(() => false),
    });

    runner.run(makeTask(), {
      onStarted,
      onDelta,
      onCompleted,
      onFailed: vi.fn(),
    });

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalled());

    expect(onStarted).toHaveBeenCalledWith('session-1');
    expect(onDelta).toHaveBeenCalledWith('Hello ');
    expect(onDelta).toHaveBeenCalledWith('world');
    expect(onCompleted).toHaveBeenCalledWith({
      resultSummary: 'Hello world',
      responseText: 'Hello world',
      toolCount: 1,
    });
    expect(handleRunStart).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'orchestrator-task-1' }),
      expect.objectContaining({
        type: 'run_start',
        sessionId: 'session-1',
        input: 'Review latest diff',
        llmProfileId: 'profile-1',
        permissionOverride: { profile: { fileWrite: 'ask' } },
        _contextTemplate: 'review',
      }),
      db,
      {},
      clients,
    );
    expect(clients.has('orchestrator-task-1')).toBe(false);
  });
});
