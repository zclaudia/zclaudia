import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
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
