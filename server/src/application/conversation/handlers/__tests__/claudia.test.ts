import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

import {
  handleClaudiaMessage,
  handleClaudiaTaskCancel,
  handleClaudiaTaskContinue,
  handleClaudiaTaskSubmit,
} from '../claudia.js';
import { ClaudiaBranchService } from '../../../orchestration/claudia-branch-service.js';
import type { ActiveRun } from '../../transport/types.js';

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

// ActiveRun stub with just the fields the busy check reads.
function makeRun(sessionId: string, phase: string): ActiveRun {
  return { sessionId, phase } as unknown as ActiveRun;
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

describe('handleClaudiaMessage (P0)', () => {
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
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','readonly')),
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
        forked_from_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        fork_entry_id TEXT,
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

      CREATE TABLE claudia_request_records (
        client_request_id   TEXT PRIMARY KEY,
        caller_scope        TEXT NOT NULL,
        project_id          TEXT NOT NULL,
        branch_id           TEXT,
        session_id          TEXT,
        run_id              TEXT,
        payload_fingerprint TEXT NOT NULL,
        outcome             TEXT NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'uncertain')),
        error_code          TEXT,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL
      );

      INSERT INTO projects (id, name, default_agent_profile_id, root_path, created_at, updated_at)
      VALUES ('project-1', 'Project One', NULL, '/tmp/project-one', 1, 1);
    `);
    return db;
  }

  function makeCoordination(db: Database.Database) {
    const branchService = new ClaudiaBranchService(db);
    return {
      branchService,
      allocateBranch: vi.fn(opts => branchService.allocateBranch(opts)),
      findBranch: vi.fn((branchId: string) => {
        const branch = branchService.findById(branchId);
        if (!branch) return null;
        return {
          id: branch.id,
          hostProjectId: branch.hostProjectId,
          activeSessionId: branch.activeSessionId,
        };
      }),
      createBranch: vi.fn(opts => ({ id: branchService.createBranch(opts).id })),
      setActiveBranchId: vi.fn((projectId: string, branchId: string | null) =>
        branchService.setActiveBranchId(projectId, branchId)
      ),
      attachSession: vi.fn((branchId: string, sessionId: string) =>
        branchService.attachSession(branchId, sessionId)
      ),
      updateBranchTask: vi.fn(),
      submitCanonicalAgentTask: vi.fn(),
      getCanonicalAgentTask: vi.fn(),
      continueCanonicalAgentTask: vi.fn(),
      cancelCanonicalAgentTask: vi.fn(),
    };
  }

  function makeCtx(
    db: Database.Database,
    coordination: ReturnType<typeof makeCoordination>,
    options: {
      activeRuns?: Map<string, ActiveRun>;
      handleRunStart?: (...args: unknown[]) => Promise<void>;
    } = {}
  ) {
    return {
      activeRuns: options.activeRuns ?? new Map<string, ActiveRun>(),
      connectedClients: new Map(),
      handleRunStart: options.handleRunStart ?? vi.fn(async () => {}),
      taskCoordination: coordination,
    };
  }

  it('sends an accepted receipt with full run identity and never writes a canonical task', async () => {
    const db = createInlineMessageDb();
    db.exec(`
      INSERT INTO llm_profiles (id, name, provider_type, is_default, created_at, updated_at)
      VALUES ('llm-1', 'LLM One', 'anthropic', 1, 1, 1);
      INSERT INTO agent_profiles (id, name, llm_profile_id, is_default, created_at, updated_at)
      VALUES ('agent-1', 'Dev Agent', 'llm-1', 1, 1, 1);
    `);
    const { client, sent } = makeClient();
    const coordination = makeCoordination(db);
    const clients = new Map();

    // Simulate the run: occupancy, then the standard run events through the
    // wrapper client (run_started → delta → run_completed).
    const handleRunStart = vi.fn(async (_wrapper: unknown, runStart: { sessionId: string }) => {
      const wrapper = [...clients.values()].find(
        (c: { id: string }) => c.id === `claudia-inline-req-inline-1`
      ) as { ws: { send: (data: string) => void } } | undefined;
      expect(wrapper).toBeDefined();
      wrapper!.ws.send(
        JSON.stringify({
          type: 'run_started',
          runId: 'run-1',
          sessionId: runStart.sessionId,
          clientRequestId: 'req-inline-1',
        })
      );
      wrapper!.ws.send(
        JSON.stringify({
          type: 'delta',
          runId: 'run-1',
          sessionId: runStart.sessionId,
          content: 'Hello',
        })
      );
      wrapper!.ws.send(
        JSON.stringify({ type: 'run_completed', runId: 'run-1', sessionId: runStart.sessionId })
      );
    });

    await handleClaudiaMessage(
      client,
      {
        type: 'claudia_message',
        clientRequestId: 'req-inline-1',
        projectId: 'project-1',
        input: 'Investigate login',
      } as never,
      db as never,
      clients,
      makeCtx(db as never, coordination, { handleRunStart })
    );
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'claudia_request_accepted',
        clientRequestId: 'req-inline-1',
        projectId: 'project-1',
        sessionId: expect.any(String),
        runId: 'run-1',
        agentProfileId: 'agent-1',
        agentProfileSource: 'global-default',
      })
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'claudia_message_delta',
        clientRequestId: 'req-inline-1',
        content: 'Hello',
        runId: 'run-1',
      })
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'claudia_message_completed',
        clientRequestId: 'req-inline-1',
        responseText: 'Hello',
        runId: 'run-1',
      })
    );

    // P0: no canonical task rows, no promoted messages (acceptance scenario 3/4).
    const taskCount = db.prepare('SELECT count(*) AS count FROM tasks').get() as { count: number };
    expect(taskCount.count).toBe(0);
    expect(
      sent.find(m => (m as { type: string }).type === 'claudia_message_promoted')
    ).toBeUndefined();

    // Request ledger records the accepted outcome.
    const record = db
      .prepare('SELECT * FROM claudia_request_records WHERE client_request_id = ?')
      .get('req-inline-1') as { outcome: string; run_id: string; session_id: string };
    expect(record.outcome).toBe('accepted');
    expect(record.run_id).toBe('run-1');

    db.close();
  });

  it('rejects with SESSION_BUSY when the target thread session has a non-terminal run, without forking', async () => {
    const db = createInlineMessageDb();
    db.exec(`
      INSERT INTO llm_profiles (id, name, provider_type, is_default, created_at, updated_at)
      VALUES ('llm-1', 'LLM One', 'anthropic', 1, 1, 1);
      INSERT INTO agent_profiles (id, name, llm_profile_id, is_default, created_at, updated_at)
      VALUES ('agent-1', 'Dev Agent', 'llm-1', 1, 1, 1);
      INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at)
      VALUES ('session-busy', 'project-1', 'agent-1', 1, 1);
      INSERT INTO claudia_branches (id, host_project_id, active_session_id, title, created_at, updated_at)
      VALUES ('branch-busy', 'project-1', 'session-busy', 'Busy thread', 1, 1);
    `);
    const { client, sent } = makeClient();
    const coordination = makeCoordination(db);
    const activeRuns = new Map<string, ActiveRun>([
      ['run-live', makeRun('session-busy', 'running')],
    ]);

    await handleClaudiaMessage(
      client,
      {
        type: 'claudia_message',
        clientRequestId: 'req-busy-1',
        projectId: 'project-1',
        input: 'Also work on this',
        activeBranchId: 'branch-busy',
      } as never,
      db as never,
      new Map(),
      makeCtx(db as never, coordination, { activeRuns })
    );

    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'claudia_request_rejected',
        clientRequestId: 'req-busy-1',
        code: 'SESSION_BUSY',
        sessionId: 'session-busy',
        runId: 'run-live',
      })
    );
    // No fork, no hidden branch creation (acceptance scenario 8).
    const branchCount = db.prepare('SELECT count(*) AS count FROM claudia_branches').get() as {
      count: number;
    };
    expect(branchCount.count).toBe(1);
    // The rejection is recorded so a replay resolves instead of re-running.
    const record = db
      .prepare('SELECT * FROM claudia_request_records WHERE client_request_id = ?')
      .get('req-busy-1') as { outcome: string; error_code: string };
    expect(record.outcome).toBe('rejected');
    expect(record.error_code).toBe('SESSION_BUSY');
    db.close();
  });

  it('replays the recorded outcome for a duplicate request and rejects payload conflicts', async () => {
    const db = createInlineMessageDb();
    db.exec(`
      INSERT INTO llm_profiles (id, name, provider_type, is_default, created_at, updated_at)
      VALUES ('llm-1', 'LLM One', 'anthropic', 1, 1, 1);
      INSERT INTO agent_profiles (id, name, llm_profile_id, is_default, created_at, updated_at)
      VALUES ('agent-1', 'Dev Agent', 'llm-1', 1, 1, 1);
      INSERT INTO sessions (id, project_id, agent_profile_id, created_at, updated_at)
      VALUES ('session-1', 'project-1', 'agent-1', 1, 1);
      INSERT INTO claudia_branches (id, host_project_id, active_session_id, title, created_at, updated_at)
      VALUES ('branch-1', 'project-1', 'session-1', 'Thread', 1, 1);
      INSERT INTO claudia_request_records (
        client_request_id, caller_scope, project_id, branch_id, session_id, run_id,
        payload_fingerprint, outcome, created_at, updated_at
      )
      VALUES (
        'req-dup', 'claudia_chat', 'project-1', 'branch-1', 'session-1', 'run-9',
        'fingerprint-x', 'accepted', 1, 1
      );
    `);
    const { client, sent } = makeClient();
    const coordination = makeCoordination(db);

    const sha256 = (await import('node:crypto')).createHash;
    const fingerprint = sha256('sha256')
      .update(
        JSON.stringify({
          projectId: 'project-1',
          activeBranchId: 'branch-1',
          forceNewBranch: false,
          agentProfileId: null,
          llmProfileId: null,
          contextProjectIds: [],
          primaryContextProjectId: null,
          text: 'Follow up',
        })
      )
      .digest('hex');
    db.prepare('UPDATE claudia_request_records SET payload_fingerprint = ?').run(fingerprint);

    // Same id + same payload → replayed receipt, no second branch/session/run.
    await handleClaudiaMessage(
      client,
      {
        type: 'claudia_message',
        clientRequestId: 'req-dup',
        projectId: 'project-1',
        input: 'Follow up',
        activeBranchId: 'branch-1',
      } as never,
      db as never,
      new Map(),
      makeCtx(db as never, coordination)
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'claudia_request_accepted',
        clientRequestId: 'req-dup',
        sessionId: 'session-1',
        runId: 'run-9',
        replay: true,
      })
    );

    // Same id + different payload → conflict, still one session.
    const sentConflict: unknown[] = [];
    const conflictClient = {
      id: 'client-2',
      authenticated: true,
      ws: {
        readyState: 1,
        send: vi.fn((raw: string) => {
          sentConflict.push(JSON.parse(raw));
        }),
      },
    } as never;
    await handleClaudiaMessage(
      conflictClient,
      {
        type: 'claudia_message',
        clientRequestId: 'req-dup',
        projectId: 'project-1',
        input: 'A different request',
        activeBranchId: 'branch-1',
      } as never,
      db as never,
      new Map(),
      makeCtx(db as never, coordination)
    );
    expect(sentConflict).toContainEqual(
      expect.objectContaining({
        type: 'claudia_request_rejected',
        clientRequestId: 'req-dup',
        code: 'DUPLICATE_CONFLICT',
      })
    );
    const sessionCount = db.prepare('SELECT count(*) AS count FROM sessions').get() as {
      count: number;
    };
    expect(sessionCount.count).toBe(1); // acceptance scenario 7: no second session
    db.close();
  });

  it('ignores other sessions broadcast through its virtual run client', async () => {
    const db = createInlineMessageDb();
    db.exec(`
      INSERT INTO llm_profiles (id, name, provider_type, is_default, created_at, updated_at)
      VALUES ('llm-1', 'LLM', 'anthropic', 1, 1, 1);
      INSERT INTO agent_profiles (id, name, llm_profile_id, is_default, created_at, updated_at)
      VALUES ('agent-1', 'Agent', 'llm-1', 1, 1, 1);
    `);
    const { client, sent } = makeClient();
    const coordination = makeCoordination(db);
    const clients = new Map();
    const ctx = makeCtx(db, coordination, {
      handleRunStart: vi.fn(async (wrapper: any, message: any) => {
        wrapper.ws.send(
          JSON.stringify({
            type: 'run_started',
            sessionId: 'another-session',
            runId: 'another-run',
          })
        );
        wrapper.ws.send(
          JSON.stringify({
            type: 'delta',
            sessionId: 'another-session',
            runId: 'another-run',
            content: 'unrelated',
          })
        );
        wrapper.ws.send(
          JSON.stringify({
            type: 'run_completed',
            sessionId: 'another-session',
            runId: 'another-run',
          })
        );
        wrapper.ws.send(
          JSON.stringify({ type: 'run_started', sessionId: message.sessionId, runId: 'own-run' })
        );
        wrapper.ws.send(
          JSON.stringify({
            type: 'delta',
            sessionId: message.sessionId,
            runId: 'own-run',
            content: 'own result',
          })
        );
        wrapper.ws.send(
          JSON.stringify({ type: 'run_completed', sessionId: message.sessionId, runId: 'own-run' })
        );
      }),
    });
    await handleClaudiaMessage(
      client,
      {
        type: 'claudia_message',
        clientRequestId: 'isolated',
        projectId: 'project-1',
        input: 'hello',
      },
      db as never,
      clients,
      ctx
    );
    expect(sent.filter((event: any) => event.type === 'claudia_request_accepted')).toHaveLength(1);
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'claudia_message_completed',
        runId: 'own-run',
        responseText: 'own result',
      })
    );
    expect(JSON.stringify(sent)).not.toContain('unrelated');
    db.close();
  });

  it.each([
    { activeBranchId: 'another-thread' },
    { forceNewBranch: true },
    { llmProfileId: 'another-model' },
    { contextProjectIds: ['project-1'] },
  ])('rejects retries that change execution context: %j', async changed => {
    const db = createInlineMessageDb();
    db.exec(`
      INSERT INTO llm_profiles (id, name, provider_type, is_default, created_at, updated_at)
      VALUES ('llm-1', 'LLM', 'anthropic', 1, 1, 1);
      INSERT INTO agent_profiles (id, name, llm_profile_id, is_default, created_at, updated_at)
      VALUES ('agent-1', 'Agent', 'llm-1', 1, 1, 1);
    `);
    const { client, sent } = makeClient();
    const coordination = makeCoordination(db);
    const ctx = makeCtx(db, coordination);
    const message = {
      type: 'claudia_message',
      clientRequestId: 'context-retry',
      projectId: 'project-1',
      input: 'hello',
    } as const;
    await handleClaudiaMessage(client, message, db as never, new Map(), ctx);
    await handleClaudiaMessage(client, { ...message, ...changed }, db as never, new Map(), ctx);
    expect(sent).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_CONFLICT' }));
    expect(ctx.handleRunStart).toHaveBeenCalledTimes(1);
    db.close();
  });

  it('rejects a stale thread instead of silently creating a new conversation', async () => {
    const db = createInlineMessageDb();
    const { client, sent } = makeClient();
    const coordination = makeCoordination(db);
    const ctx = makeCtx(db, coordination);
    await handleClaudiaMessage(
      client,
      {
        type: 'claudia_message',
        clientRequestId: 'stale-thread',
        projectId: 'project-1',
        input: 'continue with the same context',
        activeBranchId: 'deleted-thread',
      },
      db as never,
      new Map(),
      ctx
    );
    expect(sent).toContainEqual(expect.objectContaining({ code: 'THREAD_NOT_FOUND' }));
    expect(coordination.createBranch).not.toHaveBeenCalled();
    expect(ctx.handleRunStart).not.toHaveBeenCalled();
    db.close();
  });

  it('rejects an unusable explicit agent without creating state and without silent fallback', async () => {
    const db = createInlineMessageDb();
    db.exec(`
      INSERT INTO llm_profiles (id, name, provider_type, is_default, created_at, updated_at)
      VALUES ('llm-1', 'LLM One', 'anthropic', 1, 1, 1);
      INSERT INTO agent_profiles (id, name, llm_profile_id, is_default, created_at, updated_at)
      VALUES ('agent-1', 'Dev Agent', 'llm-1', 1, 1, 1);
      INSERT INTO agent_profiles (id, name, llm_profile_id, status, created_at, updated_at)
      VALUES ('agent-ro', 'Archived Agent', 'llm-1', 'readonly', 1, 1);
    `);
    const { client, sent } = makeClient();
    const coordination = makeCoordination(db);

    await handleClaudiaMessage(
      client,
      {
        type: 'claudia_message',
        clientRequestId: 'req-explicit-1',
        projectId: 'project-1',
        input: 'Work on this',
        agentProfileId: 'agent-ro',
      } as never,
      db as never,
      new Map(),
      makeCtx(db as never, coordination)
    );

    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'claudia_request_rejected',
        clientRequestId: 'req-explicit-1',
        code: 'AGENT_UNAVAILABLE',
      })
    );
    expect(
      (db.prepare('SELECT count(*) AS count FROM sessions').get() as { count: number }).count
    ).toBe(0);
    expect(
      (db.prepare('SELECT count(*) AS count FROM claudia_branches').get() as { count: number })
        .count
    ).toBe(0);
    db.close();
  });

  it('binds an explicit agent on a new conversation and reports the source', async () => {
    const db = createInlineMessageDb();
    db.exec(`
      INSERT INTO llm_profiles (id, name, provider_type, is_default, created_at, updated_at)
      VALUES ('llm-1', 'LLM One', 'anthropic', 1, 1, 1);
      INSERT INTO agent_profiles (id, name, llm_profile_id, is_default, created_at, updated_at)
      VALUES ('agent-1', 'Dev Agent', 'llm-1', 1, 1, 1);
      INSERT INTO agent_profiles (id, name, llm_profile_id, created_at, updated_at)
      VALUES ('agent-2', 'Review Agent', 'llm-1', 1, 1);
    `);
    const { client, sent } = makeClient();
    const coordination = makeCoordination(db);

    await handleClaudiaMessage(
      client,
      {
        type: 'claudia_message',
        clientRequestId: 'req-explicit-2',
        projectId: 'project-1',
        input: 'Review this diff',
        agentProfileId: 'agent-2',
      } as never,
      db as never,
      new Map(),
      makeCtx(db as never, coordination)
    );

    const session = db
      .prepare('SELECT agent_profile_id FROM sessions ORDER BY created_at DESC LIMIT 1')
      .get() as { agent_profile_id: string };
    expect(session.agent_profile_id).toBe('agent-2');

    // No rejection: the explicit pick was honored (acceptance scenario 2).
    expect(
      sent.find(m => (m as { type: string }).type === 'claudia_request_rejected')
    ).toBeUndefined();

    db.close();
  });

  it('rolls back branch allocation when inline session prerequisites fail', async () => {
    const db = createInlineMessageDb();
    const { client, sent } = makeClient();
    const coordination = makeCoordination(db);

    await handleClaudiaMessage(
      client,
      {
        type: 'claudia_message',
        clientRequestId: 'req-inline-rollback',
        projectId: 'project-1',
        input: 'Investigate login',
      } as never,
      db as never,
      new Map(),
      makeCtx(db as never, coordination)
    );

    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'claudia_request_rejected',
        clientRequestId: 'req-inline-rollback',
        code: 'NO_AGENT_AVAILABLE',
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
    // The failed attempt stays registered so a retry with the same id cannot
    // start a duplicate run after partial setup.
    const record = db
      .prepare('SELECT * FROM claudia_request_records WHERE client_request_id = ?')
      .get('req-inline-rollback') as { outcome: string };
    expect(record.outcome).toBe('rejected');

    db.close();
  });
});
