import { describe, expect, it } from 'vitest';

import { createTaskRuntimeRegistry } from '../task-runtime.js';

describe('TaskRuntimeRegistry', () => {
  it('registers and retrieves runtimes by extensible string task type', () => {
    const registry = createTaskRuntimeRegistry();
    const runtime = { type: 'plugin:demo:job' };

    registry.register(runtime);

    expect(registry.get('plugin:demo:job')).toBe(runtime);
    expect(registry.get('missing')).toBeUndefined();
    expect(registry.list()).toEqual([runtime]);
  });

  it('lets later registrations replace an existing runtime', () => {
    const registry = createTaskRuntimeRegistry();
    const first = { type: 'eval' };
    const second = { type: 'eval', marker: 'new' };

    registry.register(first);
    registry.register(second);

    expect(registry.get('eval')).toBe(second);
    expect(registry.list()).toEqual([second]);
  });
});
