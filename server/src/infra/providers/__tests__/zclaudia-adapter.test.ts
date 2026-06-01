import { describe, it, expect, vi, afterEach } from 'vitest';
import { __testables } from '../zclaudia-adapter.js';

// Mock pi-ai's getModel so tests don't hit real model registry.
vi.mock('@earendil-works/pi-ai', () => ({
  getModel: vi.fn((provider: string, model: string) => {
    if (provider === 'unknown') throw new Error(`unknown provider: ${provider}`);
    if (model === 'invalid-model') throw new Error(`unknown model: ${model}`);
    return { provider, id: model, contextWindow: 200000, maxTokens: 8000 };
  }),
}));

const { AsyncQueue, buildModel } = __testables;

describe('AsyncQueue', () => {
  it('yields pushed values in order then completes on close', async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.push(2);
    q.close();
    const out: number[] = [];
    for await (const v of q) out.push(v);
    expect(out).toEqual([1, 2]);
  });

  it('supports push after iteration starts', async () => {
    const q = new AsyncQueue<string>();
    const collected: string[] = [];
    const consumer = (async () => {
      for await (const v of q) collected.push(v);
    })();
    await Promise.resolve();
    q.push('a');
    await Promise.resolve();
    q.push('b');
    q.close();
    await consumer;
    expect(collected).toEqual(['a', 'b']);
  });

  it('ignores push after close', async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.close();
    q.push(2); // dropped silently
    const out: number[] = [];
    for await (const v of q) out.push(v);
    expect(out).toEqual([1]);
  });

  it('terminates pending consumer when close() is called', async () => {
    const q = new AsyncQueue<number>();
    const collected: number[] = [];
    const consumer = (async () => {
      for await (const v of q) collected.push(v);
    })();
    // Let consumer reach awaiting state on first next()
    await Promise.resolve();
    q.close();
    await consumer;
    expect(collected).toEqual([]);
  });
});

describe('buildModel', () => {
  const originalEnv = { ...process.env };
  afterEach(() => { process.env = { ...originalEnv }; });

  it('uses defaults when env vars unset', () => {
    delete process.env.PI_PROVIDER;
    delete process.env.PI_MODEL;
    const model = buildModel();
    expect(model.provider).toBe('anthropic');
    expect(model.id).toBe('claude-sonnet-4-6');
  });

  it('honors PI_PROVIDER and PI_MODEL env', () => {
    process.env.PI_PROVIDER = 'openai';
    process.env.PI_MODEL = 'gpt-5';
    const model = buildModel();
    expect(model.provider).toBe('openai');
    expect(model.id).toBe('gpt-5');
  });

  it('propagates getModel errors (model not in registry)', () => {
    process.env.PI_MODEL = 'invalid-model';
    expect(() => buildModel()).toThrow(/unknown model: invalid-model/);
  });
});
