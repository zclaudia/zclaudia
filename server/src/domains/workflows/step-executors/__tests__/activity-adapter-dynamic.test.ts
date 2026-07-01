import { describe, it, expect, vi } from 'vitest';
import { CompositeStepExecutor } from '../composite-executor.js';
import { ActivityStepExecutorAdapter } from '../activity-adapter.js';
import { ActivityRegistry } from '../../../activities/index.js';
import type { Activity } from '../../../activities/index.js';

describe('dynamic activity routing', () => {
  it('routes a step whose activity registered AFTER the adapter was registered', async () => {
    const registry = new ActivityRegistry();
    const adapter = new ActivityStepExecutorAdapter(registry, { run: vi.fn() } as any);
    const composite = new CompositeStepExecutor();
    composite.register(adapter);

    // Register a fake activity AFTER composite.register(adapter):
    const lateActivity: Activity = {
      type: 'late_activity',
      invoke: async () => ({ status: 'completed', output: { ok: true } }),
    };
    registry.register(lateActivity);

    const node = {
      id: 'n',
      name: 'n',
      type: 'late_activity',
      config: {},
      position: { x: 0, y: 0 },
    };
    const ctx = {
      resolveTemplate: (s: string) => s,
      projectRootPath: '/tmp',
      projectId: 'p1',
    };
    const result = await composite.execute(node as any, {}, ctx as any);
    expect(result.status).toBe('completed');
  });
});
