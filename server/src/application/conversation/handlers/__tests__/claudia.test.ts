import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

import { handleClaudiaTaskCancel, handleClaudiaTaskContinue, handleClaudiaTaskSubmit } from '../claudia.js';

function makeClient() {
  const sent: unknown[] = [];
  return {
    client: {
      id: 'client-1',
      authenticated: true,
      ws: {
        readyState: 1,
        send: vi.fn((raw: string) => {
          sent.push(JSON.parse(raw));
        }),
      },
    } as never,
    sent,
  };
}

describe('handleClaudiaTaskSubmit', () => {
  it('creates canonical Claudia tasks instead of spawning legacy orchestrator tasks', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY);
      INSERT INTO projects (id) VALUES ('project-1');
    `);
    const { client, sent } = makeClient();
    const taskCoordination = {
      allocateBranch: vi.fn(() => ({
        branchId: 'branch-1',
        sessionId: 'session-1',
        action: 'created',
        contextReset: false,
      })),
      setActiveBranchId: vi.fn(),
      updateBranchTask: vi.fn(),
      submitCanonicalAgentTask: vi.fn(async () => ({
        taskId: 'canonical-task-1',
        sessionId: 'session-1',
      })),
      spawnTask: vi.fn(),
    };

    await handleClaudiaTaskSubmit(client, {
      type: 'claudia_task_submit',
      clientRequestId: 'req-1',
      projectId: 'project-1',
      input: 'Investigate login',
      llmProfileId: 'profile-1',
    } as never, db as never, taskCoordination as never);

    expect(taskCoordination.submitCanonicalAgentTask).toHaveBeenCalledWith(expect.objectContaining({
      input: 'Investigate login',
      projectId: 'project-1',
      llmProfileId: 'profile-1',
      branchId: 'branch-1',
      branchAction: 'created',
      contextReset: false,
      title: 'Investigate login',
    }));
    expect(taskCoordination.spawnTask).not.toHaveBeenCalled();
    expect(taskCoordination.updateBranchTask).toHaveBeenCalledWith('branch-1', 'canonical-task-1', 'session-1');
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'claudia_task_created',
      clientRequestId: 'req-1',
      taskId: 'canonical-task-1',
      sessionId: 'session-1',
      branchId: 'branch-1',
      status: 'queued',
    }));
    db.close();
  });

  it('continues canonical Claudia tasks instead of spawning legacy orchestrator tasks', async () => {
    const db = new Database(':memory:');
    const { client, sent } = makeClient();
    const taskCoordination = {
      getCanonicalAgentTask: vi.fn(() => ({
        taskId: 'parent-task-1',
        projectId: 'project-1',
        branchId: 'branch-parent',
        llmProfileId: 'profile-1',
      })),
      allocateForContinue: vi.fn(() => ({
        branchId: 'branch-2',
        sessionId: 'session-2',
        action: 'forked',
        contextReset: true,
      })),
      setActiveBranchId: vi.fn(),
      updateBranchTask: vi.fn(),
      continueCanonicalAgentTask: vi.fn(async () => ({
        taskId: 'canonical-task-2',
        sessionId: 'session-2',
      })),
      spawnTask: vi.fn(),
    };

    await handleClaudiaTaskContinue(client, {
      type: 'claudia_task_continue',
      clientRequestId: 'req-2',
      taskId: 'parent-task-1',
      input: 'Continue investigation',
    } as never, db as never, taskCoordination as never);

    expect(taskCoordination.continueCanonicalAgentTask).toHaveBeenCalledWith(expect.objectContaining({
      parentTaskId: 'parent-task-1',
      input: 'Continue investigation',
      projectId: 'project-1',
      branchId: 'branch-2',
      branchAction: 'forked',
      contextReset: true,
      title: 'Continue investigation',
    }));
    expect(taskCoordination.spawnTask).not.toHaveBeenCalled();
    expect(taskCoordination.updateBranchTask).toHaveBeenCalledWith('branch-2', 'canonical-task-2', 'session-2');
    expect(sent).toContainEqual(expect.objectContaining({
      type: 'claudia_task_created',
      clientRequestId: 'req-2',
      taskId: 'canonical-task-2',
      sessionId: 'session-2',
      branchId: 'branch-2',
      status: 'queued',
      contextReset: true,
    }));
    db.close();
  });

  it('cancels canonical Claudia tasks without killing legacy orchestrator tasks', async () => {
    const { client, sent } = makeClient();
    const taskCoordination = {
      getCanonicalAgentTask: vi.fn(() => ({ taskId: 'canonical-task-1', projectId: 'project-1' })),
      cancelCanonicalAgentTask: vi.fn(async () => true),
      getTask: vi.fn(),
      killTask: vi.fn(),
    };

    await handleClaudiaTaskCancel(client, {
      type: 'claudia_task_cancel',
      taskId: 'canonical-task-1',
    } as never, taskCoordination as never);

    expect(taskCoordination.cancelCanonicalAgentTask).toHaveBeenCalledWith('canonical-task-1');
    expect(taskCoordination.killTask).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});
