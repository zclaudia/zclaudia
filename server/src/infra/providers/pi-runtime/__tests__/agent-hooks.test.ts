import { describe, it, expect, vi } from 'vitest';
import { buildAgentHooks, truncateContent, DEFAULT_OUTPUT_LIMIT_BYTES } from '../agent-hooks.js';

describe('truncateContent', () => {
  it('passes through when total size is under limit', () => {
    const content = [{ type: 'text', text: 'small content' }];
    const result = truncateContent(content, 'read', 1024);
    expect(result.didTruncate).toBe(false);
    expect(result.content).toEqual(content);
    expect(result.originalSize).toBe(Buffer.byteLength('small content', 'utf8'));
  });

  it('non-text blocks pass through unchanged', () => {
    const content = [{ type: 'image', source: { data: 'xxx' } }];
    const result = truncateContent(content as any, 'read', 100);
    expect(result.didTruncate).toBe(false);
    expect(result.content).toEqual(content);
  });

  it('Read tool: head truncation — keeps the BEGINNING', () => {
    const longText = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const content = [{ type: 'text', text: longText }];
    const result = truncateContent(content, 'read', 1024);
    expect(result.didTruncate).toBe(true);
    const truncatedText = (result.content[0] as { text: string }).text;
    expect(truncatedText.startsWith('line 0')).toBe(true);   // head kept
    expect(truncatedText.includes('line 499')).toBe(false);  // tail dropped
  });

  it('Bash tool: tail truncation — keeps the END', () => {
    const longText = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const content = [{ type: 'text', text: longText }];
    const result = truncateContent(content, 'bash', 1024);
    expect(result.didTruncate).toBe(true);
    const truncatedText = (result.content[0] as { text: string }).text;
    expect(truncatedText.includes('line 499')).toBe(true);   // tail kept
    expect(truncatedText.startsWith('line 0')).toBe(false);  // head dropped
  });

  it('unknown tool: defaults to tail (matches bash behavior)', () => {
    const longText = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const content = [{ type: 'text', text: longText }];
    const result = truncateContent(content, 'someUnknownTool', 1024);
    expect(result.didTruncate).toBe(true);
    const truncatedText = (result.content[0] as { text: string }).text;
    expect(truncatedText.includes('line 499')).toBe(true);
  });

  it('UTF-8 multibyte content is not cut mid-codepoint', () => {
    // 250 Chinese chars (3 bytes each in UTF-8) = 750 bytes
    const text = '中'.repeat(250);
    const content = [{ type: 'text', text }];
    const result = truncateContent(content, 'read', 300);
    expect(result.didTruncate).toBe(true);
    const truncatedText = (result.content[0] as { text: string }).text;
    // Every character that survived must be a valid full codepoint (no replacement char)
    expect(truncatedText.includes('�')).toBe(false);
    // Byte length is bounded — pi guarantees <= maxBytes plus marker
    expect(Buffer.byteLength(truncatedText, 'utf8')).toBeLessThanOrEqual(500);
  });

  it('preserves order of multiple text blocks', () => {
    const a = 'A'.repeat(500);
    const b = 'B'.repeat(500);
    const content = [
      { type: 'text', text: a },
      { type: 'text', text: b },
    ];
    const result = truncateContent(content, 'read', 200);
    expect(result.didTruncate).toBe(true);
    expect(result.content[0].type).toBe('text');
    expect(result.content[1].type).toBe('text');
  });

  it('preserves Read truncation across multiple line-aware boundaries', () => {
    // Use lines with known boundaries — head keeps complete lines
    const longText = Array.from({ length: 200 }, (_, i) => `line ${i.toString().padStart(3, '0')}`).join('\n');
    const content = [{ type: 'text', text: longText }];
    const result = truncateContent(content, 'read', 500);
    expect(result.didTruncate).toBe(true);
    const truncatedText = (result.content[0] as { text: string }).text;
    // pi truncateHead guarantees no mid-line cut (line-aware)
    const lines = truncatedText.split('\n').filter(l => l.startsWith('line '));
    for (const line of lines) {
      expect(line).toMatch(/^line \d{3}$/);  // exactly 8 chars, no truncation mid-line
    }
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
    const sent = permissionCallback.mock.calls[0][0];
    expect(sent.toolName).toBe('Read');           // canonical, not 'read'
    expect(typeof sent.requestId).toBe('string');
    expect(sent.requestId.length).toBeGreaterThan(0);
    expect(sent.timeoutSeconds).toBe(0);
    expect(sent.detail).toBe('/tmp/x');
  });

  it('returns block:true when permissionCallback denies', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({ behavior: 'deny', message: 'too risky' });
    const hooks = buildAgentHooks({ permissionCallback });
    const result = await hooks.beforeToolCall!({ toolCall: fakeToolCall, args: fakeToolCall.arguments } as any);
    expect(result).toEqual({ block: true, reason: 'too risky' });
    expect(permissionCallback.mock.calls[0][0].toolName).toBe('Read');
  });

  it('returns args replacement when permissionCallback returns updatedInput', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({ behavior: 'allow', updatedInput: { path: '/safer/path' } });
    const hooks = buildAgentHooks({ permissionCallback });
    const result = await hooks.beforeToolCall!({ toolCall: fakeToolCall, args: fakeToolCall.arguments } as any);
    expect(result).toEqual({ args: { path: '/safer/path' } });
    expect(permissionCallback.mock.calls[0][0].toolName).toBe('Read');
  });

  it('falls back to a default deny reason when callback gives no message', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({ behavior: 'deny' });
    const hooks = buildAgentHooks({ permissionCallback });
    const result = await hooks.beforeToolCall!({ toolCall: fakeToolCall, args: fakeToolCall.arguments } as any);
    expect(result).toEqual({ block: true, reason: 'denied by user' });
  });

  it('normalizes pi lowercase tool names to canonical (Claude Code style)', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const hooks = buildAgentHooks({ permissionCallback });
    const piNames = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'];
    const expectedCanonical = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'LS'];
    for (let i = 0; i < piNames.length; i++) {
      permissionCallback.mockClear();
      await hooks.beforeToolCall!({
        toolCall: { id: 't' + i, name: piNames[i], arguments: {} },
        args: {},
      } as any);
      expect(permissionCallback.mock.calls[0][0].toolName).toBe(expectedCanonical[i]);
    }
  });

  it('builds a readable detail string for bash command', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const hooks = buildAgentHooks({ permissionCallback });
    await hooks.beforeToolCall!({
      toolCall: { id: 't1', name: 'bash', arguments: { command: 'ls -la /tmp' } },
      args: { command: 'ls -la /tmp' },
    } as any);
    expect(permissionCallback.mock.calls[0][0].detail).toBe('ls -la /tmp');
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
