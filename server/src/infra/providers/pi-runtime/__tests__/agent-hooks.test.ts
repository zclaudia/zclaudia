import { describe, it, expect, vi } from 'vitest';
import { buildAgentHooks, truncateContent, DEFAULT_OUTPUT_LIMIT_BYTES } from '../agent-hooks.js';

describe('truncateContent', () => {
  it('passes through when total bytes <= limit', () => {
    const out = truncateContent([{ type: 'text', text: 'hello' }], 1000);
    expect(out.didTruncate).toBe(false);
    expect(out.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(out.originalSize).toBe(5);
  });

  it('truncates when total bytes > limit and appends marker', () => {
    const long = 'a'.repeat(200);
    const out = truncateContent([{ type: 'text', text: long }], 100);
    expect(out.didTruncate).toBe(true);
    expect(out.originalSize).toBe(200);
    expect(out.content[0].type).toBe('text');
    expect(out.content[0].text!.length).toBeLessThan(long.length);
    expect(out.content[0].text!).toMatch(/truncated/i);
  });

  it('does not crash on non-text blocks', () => {
    const out = truncateContent([{ type: 'image' as any, data: 'base64...' } as any], 100);
    expect(out.didTruncate).toBe(false);
  });
});

describe('buildAgentHooks.beforeToolCall', () => {
  const fakeToolCall = { id: 't1', name: 'read', arguments: { path: '/tmp/x' } };

  it('returns undefined when permissionCallback allows', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const hooks = buildAgentHooks({ permissionCallback });
    const result = await hooks.beforeToolCall!({ toolCall: fakeToolCall, args: fakeToolCall.arguments } as any);
    expect(result).toBeUndefined();
    expect(permissionCallback).toHaveBeenCalledOnce();
  });

  it('returns block:true when permissionCallback denies', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({ behavior: 'deny', message: 'too risky' });
    const hooks = buildAgentHooks({ permissionCallback });
    const result = await hooks.beforeToolCall!({ toolCall: fakeToolCall, args: fakeToolCall.arguments } as any);
    expect(result).toEqual({ block: true, reason: 'too risky' });
  });

  it('returns args replacement when permissionCallback returns updatedInput', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({ behavior: 'allow', updatedInput: { path: '/safer/path' } });
    const hooks = buildAgentHooks({ permissionCallback });
    const result = await hooks.beforeToolCall!({ toolCall: fakeToolCall, args: fakeToolCall.arguments } as any);
    expect(result).toEqual({ args: { path: '/safer/path' } });
  });

  it('falls back to a default deny reason when callback gives no message', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({ behavior: 'deny' });
    const hooks = buildAgentHooks({ permissionCallback });
    const result = await hooks.beforeToolCall!({ toolCall: fakeToolCall, args: fakeToolCall.arguments } as any);
    expect(result).toEqual({ block: true, reason: 'denied by user' });
  });
});

describe('buildAgentHooks.afterToolCall', () => {
  it('passes short results through unchanged', async () => {
    const permissionCallback = vi.fn();
    const hooks = buildAgentHooks({ permissionCallback });
    const result = await hooks.afterToolCall!({
      toolCall: { id: 't1', name: 'bash', arguments: {} } as any,
      result: { content: [{ type: 'text', text: 'short output' }] },
      isError: false,
      context: {} as any,
    } as any);
    expect(result).toBeUndefined();
  });

  it('truncates long results and patches details.truncated', async () => {
    const permissionCallback = vi.fn();
    const hooks = buildAgentHooks({ permissionCallback, outputTruncationLimit: 100 });
    const long = 'a'.repeat(500);
    const result = await hooks.afterToolCall!({
      toolCall: { id: 't1', name: 'bash', arguments: {} } as any,
      result: { content: [{ type: 'text', text: long }] },
      isError: false,
      context: {} as any,
    } as any);
    expect(result).toBeDefined();
    expect(result!.details).toMatchObject({ truncated: true, originalSize: 500 });
  });

  it('uses DEFAULT_OUTPUT_LIMIT_BYTES when not configured', () => {
    expect(DEFAULT_OUTPUT_LIMIT_BYTES).toBe(64 * 1024);
  });
});

describe('buildAgentHooks.shouldStopAfterTurn', () => {
  it('returns false when no abortSignal', async () => {
    const hooks = buildAgentHooks({ permissionCallback: vi.fn() });
    const result = await hooks.shouldStopAfterTurn!({} as any);
    expect(result).toBe(false);
  });

  it('returns false when abortSignal not aborted', async () => {
    const ctrl = new AbortController();
    const hooks = buildAgentHooks({ permissionCallback: vi.fn(), abortSignal: ctrl.signal });
    const result = await hooks.shouldStopAfterTurn!({} as any);
    expect(result).toBe(false);
  });

  it('returns true when abortSignal aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const hooks = buildAgentHooks({ permissionCallback: vi.fn(), abortSignal: ctrl.signal });
    const result = await hooks.shouldStopAfterTurn!({} as any);
    expect(result).toBe(true);
  });
});

describe('buildAgentHooks placeholders', () => {
  it('passes through transformContext and streamFn if provided', () => {
    const transformContext = vi.fn();
    const streamFn = vi.fn();
    const hooks = buildAgentHooks({ permissionCallback: vi.fn(), transformContext, streamFn });
    expect(hooks.transformContext).toBe(transformContext);
    expect(hooks.streamFn).toBe(streamFn);
  });

  it('leaves transformContext / streamFn undefined when not provided', () => {
    const hooks = buildAgentHooks({ permissionCallback: vi.fn() });
    expect(hooks.transformContext).toBeUndefined();
    expect(hooks.streamFn).toBeUndefined();
  });
});
