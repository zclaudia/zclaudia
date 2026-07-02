import { describe, expect, it } from 'vitest';

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
});
