import { describe, it, expect, vi } from 'vitest';
import { ActivityRegistry } from '../registry.js';
import type { Activity, ActivityServices } from '../types.js';

const services: ActivityServices = { agentLoopRunner: {} as never };

describe('ActivityRegistry.invoke configSchema validation', () => {
  it('rejects invoke when required config is missing', async () => {
    const registry = new ActivityRegistry();
    const invokeSpy = vi.fn(async () => ({ status: 'completed' as const, output: { ok: true } }));
    const activity: Activity = {
      type: 'demo',
      name: 'Demo',
      description: 'Demo activity',
      category: 'Test',
      configSchema: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
      invoke: invokeSpy,
    };
    registry.register(activity);

    const result = await registry.invoke('demo', {}, services);
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/config/i);
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('allows invoke when required config is present', async () => {
    const registry = new ActivityRegistry();
    const invokeSpy = vi.fn(async () => ({ status: 'completed' as const, output: { ok: true } }));
    const activity: Activity = {
      type: 'demo',
      name: 'Demo',
      description: 'Demo activity',
      category: 'Test',
      configSchema: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      },
      invoke: invokeSpy,
    };
    registry.register(activity);

    const result = await registry.invoke('demo', { name: 'x' }, services);
    expect(result.status).toBe('completed');
    expect(invokeSpy).toHaveBeenCalled();
  });
});
