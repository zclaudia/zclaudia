import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../../../../domains/tasks/repository.js';
import { TaskService } from '../../../../domains/tasks/task-service.js';
import * as taskTools from '../task-tools.js';
import { createAgentTool, createMonitorTool, createTaskOutputTool } from '../task-tools.js';

describe('task bridge tools', () => {
  it('Agent reports missing executor or database context without launching', async () => {
    const missingExecutor = createAgentTool(
      '/tmp',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    ) as any;
    const missingDb = createAgentTool('/tmp', undefined, undefined, undefined, undefined, {
      start: async () => ({ executorRef: {} }),
      wait: async () => ({ status: 'completed', result: {} }),
      stop: async () => ({ status: 'stopped', result: {} }),
    } as any) as any;

    const executorResult = await missingExecutor.execute('agent-1', { prompt: 'hello' });
    const dbResult = await missingDb.execute('agent-2', { prompt: 'hello' });

    expect(executorResult.content[0].text).toContain('Agent tool requires a task executor');
    expect(dbResult.content[0].text).toContain('Agent tool requires database context');
    // Structured failure contract: details.ok === false so the failure-loop
    // guard and remediation can see these failures.
    expect(executorResult.details).toMatchObject({ ok: false, error: 'missing_task_executor' });
    expect(dbResult.details).toMatchObject({ ok: false, error: 'missing_db_context' });
  });

  it('TaskOutput and Monitor report missing database context', async () => {
    const taskOutput = createTaskOutputTool() as any;
    const monitor = createMonitorTool() as any;

    const taskResult = await taskOutput.execute('task-output-1', { task_id: 'task-1' });
    const monitorResult = await monitor.execute('monitor-1', {
      action: 'status',
      task_id: 'task-1',
    });

    expect(taskResult.details).toMatchObject({ ok: false, error: 'missing_db_context' });
    expect(monitorResult.details).toMatchObject({ ok: false, error: 'missing_db_context' });
  });

  it('parses TaskOutput window params strictly', () => {
    const parse = (taskTools as any).parseTaskOutputWindowParams as
      | undefined
      | ((args: Record<string, unknown>) => any);
    expect(typeof parse).toBe('function');

    expect(parse!({ output_offset: 10 })).toEqual({ ok: true, outputOffset: 10 });
    expect(parse!({ tail_lines: 20 })).toEqual({ ok: true, outputOffset: 0, tailLines: 20 });
    expect(parse!({ output_offset: 1.5 })).toMatchObject({
      ok: false,
      code: 'invalid_output_offset',
    });
    expect(parse!({ output_offset: '2' })).toMatchObject({
      ok: false,
      code: 'invalid_output_offset',
    });
    expect(parse!({ tail_lines: 0 })).toMatchObject({ ok: false, code: 'invalid_tail_lines' });
    expect(parse!({ tail_lines: Number.POSITIVE_INFINITY })).toMatchObject({
      ok: false,
      code: 'invalid_tail_lines',
    });
  });

  it('Monitor start is rejected with a model-facing error and creates no task (P1-7)', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    try {
      const monitor = createMonitorTool('session-1', 'run-1', db) as any;

      const res = await monitor.execute('monitor-start-1', {
        action: 'start',
        title: 'Watch tests',
        target_task_id: 'task-agent-1',
        interval_ms: 30_000,
      });

      expect(res.details).toMatchObject({ ok: false, error: 'monitor_start_unsupported' });
      expect(res.content[0].text).toContain('no monitor runtime');
      expect(res.content[0].text).toContain('TaskOutput');
      // No zombie row: the failed start must not mint a perpetual-running task.
      expect(
        db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE type = 'monitor'`).get() as {
          n: number;
        }
      ).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });

  it('Monitor status and stop still work on a pre-existing monitor task', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    try {
      const repo = new TaskRepository(db);
      const service = new TaskService(repo);
      const legacy = service.createTask({ type: 'monitor', title: 'legacy watch' });
      service.startTask(legacy.id, {
        executorRef: { providerType: 'task-monitor', taskId: legacy.id },
      });
      const monitor = createMonitorTool(undefined, undefined, db) as any;

      const statusRes = await monitor.execute('monitor-status-1', {
        action: 'status',
        task_id: legacy.id,
      });
      const status = JSON.parse(statusRes.content[0].text);
      expect(status).toMatchObject({ ok: true, task: { id: legacy.id, status: 'running' } });

      const stopRes = await monitor.execute('monitor-stop-1', {
        action: 'stop',
        task_id: legacy.id,
        reason: 'no longer needed',
      });
      expect(JSON.parse(stopRes.content[0].text)).toMatchObject({
        ok: true,
        taskId: legacy.id,
        status: 'stopped',
      });
      expect(repo.findById(legacy.id)!.status).toBe('stopped');
    } finally {
      db.close();
    }
  });

  it('Agent never forwards model-supplied permission overrides into task metadata (P0-2)', async () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    try {
      const start = vi.fn(async (task: { id: string }) => ({
        executorRef: { providerType: 'test', taskId: task.id },
      }));
      const executor = {
        start,
        wait: vi.fn(async () => ({ status: 'completed', result: {} })),
        stop: vi.fn(async () => ({ status: 'stopped', result: {} })),
      };
      const parentOverride = { bash: 'ask' };
      const tool = createAgentTool(
        '/tmp',
        'session-1',
        'run-1',
        db,
        parentOverride as never,
        executor as never
      ) as any;

      const res = await tool.execute('agent-sec-1', {
        prompt: 'do things',
        permission_override: { bash: 'allow' },
        permissionOverride: { bash: 'allow' },
      });

      expect(JSON.parse(res.content[0].text)).toMatchObject({ ok: true });
      expect(start).toHaveBeenCalledTimes(1);
      const task = start.mock.calls[0][0] as { metadata: Record<string, unknown> };
      // Only the parent-provided factory override reaches the sub-agent task;
      // the model-supplied keys are ignored entirely.
      expect(task.metadata.permissionOverride).toEqual(parentOverride);
    } finally {
      db.close();
    }
  });

  it('Agent drops model-supplied overrides when no parent override exists (P0-2)', async () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    try {
      const start = vi.fn(async (task: { id: string }) => ({
        executorRef: { providerType: 'test', taskId: task.id },
      }));
      const executor = {
        start,
        wait: vi.fn(async () => ({ status: 'completed', result: {} })),
        stop: vi.fn(async () => ({ status: 'stopped', result: {} })),
      };
      const tool = createAgentTool(
        '/tmp',
        'session-1',
        'run-1',
        db,
        undefined,
        executor as never
      ) as any;

      const res = await tool.execute('agent-sec-2', {
        prompt: 'do things',
        permission_override: { bash: 'allow' },
      });

      expect(JSON.parse(res.content[0].text)).toMatchObject({ ok: true });
      const task = start.mock.calls[0][0] as { metadata: Record<string, unknown> };
      expect(task.metadata.permissionOverride).toBeUndefined();
    } finally {
      db.close();
    }
  });
});

describe('Agent subagent_type and session linkage', () => {
  function seedProfile(db: Database.Database, id: string, name: string, status = 'active') {
    db.prepare(
      `INSERT INTO agent_profiles (id, name, description, runtime_type, llm_profile_id, system_prompt, enabled_tools, is_default, status, source, created_at, updated_at)
       VALUES (?, ?, ?, 'pi', NULL, '', '[]', 0, ?, 'user', ?, ?)`
    ).run(id, name, `${name} profile`, status, Date.now(), Date.now());
  }

  function executorReturning(sessionId: string) {
    const start = vi.fn(async (task: { id: string }) => ({
      executorRef: { providerType: 'test', taskId: task.id },
      sessionId,
    }));
    return {
      start,
      wait: vi.fn(async () => ({ status: 'completed', result: {} })),
      stop: vi.fn(async () => ({ status: 'stopped', result: {} })),
    };
  }

  it('lists active profiles in the description and resolves by name or id', async () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    try {
      seedProfile(db, 'prof-explore', 'Explore');
      seedProfile(db, 'prof-old', 'Legacy', 'readonly');
      const executor = executorReturning('child-1');
      const tool = createAgentTool(
        '/tmp',
        'session-1',
        'run-1',
        db,
        undefined,
        executor as never
      ) as any;
      expect(tool.description).toContain('Explore: Explore profile');
      expect(tool.description).not.toContain('Legacy');

      const byName = await tool.execute('a1', { prompt: 'x', subagent_type: 'explore' });
      expect(JSON.parse(byName.content[0].text)).toMatchObject({
        ok: true,
        agentProfileId: 'prof-explore',
        sessionId: 'child-1',
      });
      const byId = await tool.execute('a2', { prompt: 'x', subagent_type: 'prof-explore' });
      expect(JSON.parse(byId.content[0].text)).toMatchObject({ agentProfileId: 'prof-explore' });
      const task = executor.start.mock.calls[0][0] as { metadata: Record<string, unknown> };
      expect(task.metadata.agentProfileId).toBe('prof-explore');
    } finally {
      db.close();
    }
  });

  it('rejects unknown or non-active subagent_type without launching', async () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    try {
      seedProfile(db, 'prof-old', 'Legacy', 'readonly');
      const executor = executorReturning('child-1');
      const tool = createAgentTool(
        '/tmp',
        'session-1',
        'run-1',
        db,
        undefined,
        executor as never
      ) as any;
      const res = await tool.execute('a1', { prompt: 'x', subagent_type: 'Legacy' });
      expect(res.details).toMatchObject({ ok: false, error: 'unknown_subagent_type' });
      expect(executor.start).not.toHaveBeenCalled();
      const empty = await tool.execute('a2', { prompt: 'x', subagent_type: '   ' });
      expect(empty.details).toMatchObject({ ok: false, error: 'invalid_subagent_type' });
    } finally {
      db.close();
    }
  });

  it('persists the sub-agent session id on the task row', async () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    try {
      const executor = executorReturning('child-9');
      const tool = createAgentTool(
        '/tmp',
        'session-1',
        'run-1',
        db,
        undefined,
        executor as never
      ) as any;
      const res = await tool.execute('a1', { prompt: 'x' });
      const { taskId } = JSON.parse(res.content[0].text);
      const row = new TaskRepository(db).findById(taskId);
      expect(row?.sessionId).toBe('child-9');
      expect(row?.status).toBe('running');
    } finally {
      db.close();
    }
  });
});

describe('SendMessage', () => {
  function setup() {
    const db = new Database(':memory:');
    applyMigrations(db);
    const service = new TaskService(new TaskRepository(db));
    const steer = vi.fn(() => ({ delivery: 'steered' as const }));
    const notify = vi.fn(() => ({ delivery: 'steered' as const }));
    const messenger = { steer, notify };
    const start = vi.fn(async (task: { id: string }) => ({
      executorRef: { providerType: 'test', taskId: task.id },
      sessionId: 'child-1',
    }));
    const executor = {
      start,
      wait: vi.fn(async () => ({ status: 'completed', result: {} })),
      stop: vi.fn(async () => ({ status: 'stopped', result: {} })),
    };
    const tool = taskTools.createSendMessageTool({
      cwd: '/tmp',
      sessionId: 'parent',
      runId: 'run-1',
      db,
      permissionOverride: { profile: { fileWrite: 'ask' } } as never,
      agentTaskExecutor: executor as never,
      messenger,
    }) as any;
    const child = service.createTask({
      type: 'agent',
      title: 'child',
      parentSessionId: 'parent',
      metadata: { prompt: 'p', cwd: '/tmp', projectId: 'proj', agentProfileId: 'prof-x' },
    });
    service.startTask(child.id, { sessionId: 'child-1' });
    return { db, service, steer, notify, start, tool, child };
  }

  it('steers a running sub-agent with a coordinator-tagged message', async () => {
    const { db, steer, tool, child } = setup();
    try {
      const res = await tool.execute('s1', { task_id: child.id, message: 'focus on tests' });
      expect(JSON.parse(res.content[0].text)).toMatchObject({
        ok: true,
        taskId: child.id,
        delivery: 'steered',
        sessionId: 'child-1',
      });
      expect(steer).toHaveBeenCalledWith('child-1', '[Message from coordinator]\nfocus on tests');
    } finally {
      db.close();
    }
  });

  it('resumes a finished sub-agent on the same session in the background', async () => {
    const { db, service, start, tool, child } = setup();
    try {
      service.completeTask(child.id, { text: 'done' });
      const res = await tool.execute('s2', { task_id: child.id, message: 'one more thing' });
      const body = JSON.parse(res.content[0].text);
      expect(body).toMatchObject({
        ok: true,
        delivery: 'resumed_background',
        resumedFromTaskId: child.id,
        sessionId: 'child-1',
      });
      expect(start).toHaveBeenCalledTimes(1);
      const resumed = start.mock.calls[0][0] as { metadata: Record<string, unknown> };
      expect(resumed.metadata).toMatchObject({
        sessionId: 'child-1',
        resumedFromTaskId: child.id,
        agentProfileId: 'prof-x',
        cwd: '/tmp',
        projectId: 'proj',
      });
      expect(resumed.metadata.prompt).toBe('[Message from coordinator]\none more thing');
      const row = new TaskRepository(db).findById(body.taskId);
      expect(row?.status).toBe('running');
      expect(row?.sessionId).toBe('child-1');
    } finally {
      db.close();
    }
  });

  it('refuses tasks it does not own, non-agent tasks, and unknown ids', async () => {
    const { db, service, steer, tool } = setup();
    try {
      const foreign = service.createTask({
        type: 'agent',
        parentSessionId: 'someone-else',
        metadata: { prompt: 'p' },
      });
      service.startTask(foreign.id, { sessionId: 'child-2' });
      const notOwned = await tool.execute('s3', { task_id: foreign.id, message: 'hi' });
      expect(notOwned.details).toMatchObject({ ok: false, error: 'task_not_owned' });

      const command = service.createTask({
        type: 'command',
        parentSessionId: 'parent',
        metadata: { command: 'ls' },
      });
      const wrongType = await tool.execute('s4', { task_id: command.id, message: 'hi' });
      expect(wrongType.details).toMatchObject({ ok: false, error: 'not_an_agent_task' });

      const missing = await tool.execute('s5', { task_id: 'nope', message: 'hi' });
      expect(missing.details).toMatchObject({ ok: false, error: 'task_not_found' });
      expect(steer).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('reports not_ready as retryable and validates arguments', async () => {
    const { db, steer, tool, child } = setup();
    try {
      steer.mockReturnValueOnce({ delivery: 'not_ready' as const });
      const res = await tool.execute('s6', { task_id: child.id, message: 'hi' });
      expect(res.details).toMatchObject({
        ok: false,
        error: 'subagent_not_ready',
        retryable: true,
      });

      const noMessage = await tool.execute('s7', { task_id: child.id, message: '  ' });
      expect(noMessage.details).toMatchObject({ ok: false, error: 'missing_message' });
    } finally {
      db.close();
    }
  });
});

describe('RespondToCoordinator', () => {
  it('delivers a system notice to the launching session and reports delivery', async () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    try {
      const service = new TaskService(new TaskRepository(db));
      const child = service.createTask({
        type: 'agent',
        title: 'child',
        parentSessionId: 'parent',
        metadata: { prompt: 'p' },
      });
      service.startTask(child.id, { sessionId: 'child-1' });
      const notify = vi.fn(() => ({ delivery: 'queued' as const }));
      const tool = taskTools.createRespondToCoordinatorTool({
        sessionId: 'child-1',
        db,
        messenger: { steer: vi.fn(), notify } as never,
      }) as any;
      const res = await tool.execute('r1', { summary: 'found the bug', response: 'It is in x.ts' });
      expect(JSON.parse(res.content[0].text)).toMatchObject({
        ok: true,
        taskId: child.id,
        coordinatorSessionId: 'parent',
        delivery: 'queued',
      });
      const notice = notify.mock.calls[0][1] as string;
      expect(notice).toContain('<system-reminder>');
      expect(notice).toContain(`Sub-agent task ${child.id} ("child") reports: found the bug`);
      expect(notice).toContain('It is in x.ts');
      expect(notice).toContain(`SendMessage({ task_id: "${child.id}"`);
    } finally {
      db.close();
    }
  });

  it('errors when the session was not launched by a coordinator', async () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    try {
      const tool = taskTools.createRespondToCoordinatorTool({
        sessionId: 'lonely',
        db,
        messenger: { steer: vi.fn(), notify: vi.fn() } as never,
      }) as any;
      const res = await tool.execute('r2', { summary: 's', response: 'r' });
      expect(res.details).toMatchObject({ ok: false, error: 'no_coordinator' });
    } finally {
      db.close();
    }
  });
});
