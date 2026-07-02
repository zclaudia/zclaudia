import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

import {
  handleClaudiaMessage,
  handleClaudiaTaskCancel,
  handleClaudiaTaskContinue,
  handleClaudiaTaskSubmit,
} from '../claudia.js';
import { ClaudiaBranchService } from '../../../orchestration/claudia-branch-service.js';

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

    await handleClaudiaTaskSubmit(
      client,
      {
        type: 'claudia_task_submit',
        clientRequestId: 'req-1',
        projectId: 'project-1',
        input: 'Investigate login',
        llmProfileId: 'profile-1',
      } as never,
      db as never,
      taskCoordination as never
    );

    expect(taskCoordination.submitCanonicalAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({
        input: 'Investigate login',
        projectId: 'project-1',
        llmProfileId: 'profile-1',
        branchId: 'branch-1',
        branchAction: 'created',
        contextReset: false,
        title: 'Investigate login',
      })
    );
    expect(taskCoordination.spawnTask).not.toHaveBeenCalled();
    expect(taskCoordination.updateBranchTask).toHaveBeenCalledWith(
      'branch-1',
      'canonical-task-1',
      'session-1'
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'claudia_task_created',
        clientRequestId: 'req-1',
        taskId: 'canonical-task-1',
        sessionId: 'session-1',
        branchId: 'branch-1',
        status: 'queued',
      })
    );
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

    await handleClaudiaTaskContinue(
      client,
      {
        type: 'claudia_task_continue',
        clientRequestId: 'req-2',
        taskId: 'parent-task-1',
        input: 'Continue investigation',
      } as never,
      db as never,
      taskCoordination as never
    );

    expect(taskCoordination.continueCanonicalAgentTask).toHaveBeenCalledWith(
      expect.objectContaining({
        parentTaskId: 'parent-task-1',
        input: 'Continue investigation',
        projectId: 'project-1',
        branchId: 'branch-2',
        branchAction: 'forked',
        contextReset: true,
        title: 'Continue investigation',
      })
    );
    expect(taskCoordination.spawnTask).not.toHaveBeenCalled();
    expect(taskCoordination.updateBranchTask).toHaveBeenCalledWith(
      'branch-2',
      'canonical-task-2',
      'session-2'
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'claudia_task_created',
        clientRequestId: 'req-2',
        taskId: 'canonical-task-2',
        sessionId: 'session-2',
        branchId: 'branch-2',
        status: 'queued',
        contextReset: true,
      })
    );
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

    await handleClaudiaTaskCancel(
      client,
      {
        type: 'claudia_task_cancel',
        taskId: 'canonical-task-1',
      } as never,
      taskCoordination as never
    );

    expect(taskCoordination.cancelCanonicalAgentTask).toHaveBeenCalledWith('canonical-task-1');
    expect(taskCoordination.killTask).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });
});

describe('handleClaudiaMessage', () => {
  function createInlineMessageDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        default_agent_profile_id TEXT,
        root_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE llm_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider_type TEXT NOT NULL DEFAULT 'anthropic',
        is_default INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE agent_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        llm_profile_id TEXT NOT NULL REFERENCES llm_profiles(id) ON DELETE RESTRICT,
        model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
        system_prompt TEXT NOT NULL DEFAULT '',
        is_default INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT,
        agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE RESTRICT,
        sdk_session_id TEXT,
        type TEXT CHECK(type IN ('regular', 'background', 'agent')) DEFAULT 'regular',
        parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        working_directory TEXT,
        project_role TEXT,
        task_id TEXT,
        plan_status TEXT,
        is_read_only INTEGER DEFAULT 0,
        last_run_status TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived_at INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE claudia_branches (
        id TEXT PRIMARY KEY,
        host_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        active_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_task_id TEXT
      );

      CREATE TABLE claudia_project_state (
        host_project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        active_branch_id TEXT REFERENCES claudia_branches(id) ON DELETE SET NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO projects (id, name, default_agent_profile_id, root_path, created_at, updated_at)
      VALUES ('project-1', 'Project One', NULL, '/tmp/project-one', 1, 1);
    `);
    return db;
  }

  it('rolls back branch allocation when inline session prerequisites fail', async () => {
    const db = createInlineMessageDb();
    const { client, sent } = makeClient();
    const branchService = new ClaudiaBranchService(db);
    const taskCoordination = {
      allocateBranch: vi.fn(opts => branchService.allocateBranch(opts)),
      allocateForContinue: vi.fn(opts => branchService.allocateForContinue(opts)),
      setActiveBranchId: vi.fn((projectId, branchId) =>
        branchService.setActiveBranchId(projectId, branchId)
      ),
      attachSession: vi.fn((branchId, sessionId) =>
        branchService.attachSession(branchId, sessionId)
      ),
      updateBranchTask: vi.fn(),
      submitCanonicalAgentTask: vi.fn(),
      getCanonicalAgentTask: vi.fn(),
      continueCanonicalAgentTask: vi.fn(),
      cancelCanonicalAgentTask: vi.fn(),
    };

    await handleClaudiaMessage(
      client,
      {
        type: 'claudia_message',
        clientRequestId: 'req-inline-1',
        projectId: 'project-1',
        input: 'Investigate login',
      } as never,
      db as never,
      new Map(),
      {
        activeRuns: new Map(),
        connectedClients: new Map(),
        handleRunStart: vi.fn(),
        taskCoordination: taskCoordination as never,
      }
    );

    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'claudia_message_failed',
        clientRequestId: 'req-inline-1',
        error: 'No default agent profile available — create one in Settings first',
      })
    );
    expect(
      (db.prepare('SELECT count(*) AS count FROM claudia_branches').get() as { count: number })
        .count
    ).toBe(0);
    expect(
      (db.prepare('SELECT count(*) AS count FROM claudia_project_state').get() as { count: number })
        .count
    ).toBe(0);
    expect(
      (db.prepare('SELECT count(*) AS count FROM sessions').get() as { count: number }).count
    ).toBe(0);

    db.close();
  });
});
