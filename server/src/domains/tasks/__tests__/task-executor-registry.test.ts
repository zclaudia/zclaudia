import { describe, expect, it, vi } from 'vitest';

import { TaskExecutorRegistry } from '../executors/registry.js';
import type { TaskExecutor } from '../executors/types.js';

function makeExecutor(type: TaskExecutor['type']): TaskExecutor {
  return {
    type,
    start: vi.fn(async () => ({ status: 'running' })),
    wait: vi.fn(async () => ({ status: 'completed', result: { text: 'done' } })),
    stop: vi.fn(async () => ({ status: 'stopped' })),
  };
}

describe('TaskExecutorRegistry', () => {
  it('registers and resolves executors by task type', () => {
    const registry = new TaskExecutorRegistry();
    const executor = makeExecutor('agent');

    registry.register(executor);

    expect(registry.get('agent')).toBe(executor);
    expect(registry.getRequired('agent')).toBe(executor);
    expect(() => registry.getRequired('command')).toThrow('No task executor registered: command');
  });

  it('replaces an existing executor for the same task type', () => {
    const registry = new TaskExecutorRegistry();
    const first = makeExecutor('agent');
    const second = makeExecutor('agent');

    registry.register(first);
    registry.register(second);

    expect(registry.getRequired('agent')).toBe(second);
  });
});
