import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
    const limit = 300;
    const result = truncateContent(content, 'read', limit);
    expect(result.didTruncate).toBe(true);
    const truncatedText = (result.content[0] as { text: string }).text;
    // No replacement char ⇒ no mid-codepoint cut
    expect(truncatedText.includes('�')).toBe(false);
    // Pi must respect maxBytes for the body; marker overhead is bounded by our constant.
    // Single block ⇒ perBlockLimit = limit - TRUNC_MARKER_OVERHEAD_BYTES = 260.
    // Final size = body (≤ 260) + marker (~30 bytes). Bound at limit + 60 to be safe.
    expect(Buffer.byteLength(truncatedText, 'utf8')).toBeLessThanOrEqual(limit + 60);
  });

  it('preserves order of multiple text blocks (head — A first, B second)', () => {
    const a = 'AAAAA\n'.repeat(100);  // 600 bytes, all A's
    const b = 'BBBBB\n'.repeat(100);  // 600 bytes, all B's
    const content = [
      { type: 'text', text: a },
      { type: 'text', text: b },
    ];
    const result = truncateContent(content, 'read', 400);
    expect(result.didTruncate).toBe(true);
    expect(result.content).toHaveLength(2);
    // Order is preserved AND each block was independently truncated from its own source
    const t0 = (result.content[0] as { text: string }).text;
    const t1 = (result.content[1] as { text: string }).text;
    expect(t0).toMatch(/^A+/);            // first block still A's
    expect(t0.includes('B')).toBe(false); // no cross-contamination
    expect(t1).toMatch(/^B+/);            // second block still B's
    expect(t1.includes('A')).toBe(false);
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
  const fakeToolCall = { id: 't1', name: 'Read', arguments: { path: '/tmp/x' } };

  it('returns undefined when permissionCallback allows', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const hooks = buildAgentHooks({ permissionCallback });
    const result = await hooks.beforeToolCall!({ toolCall: fakeToolCall, args: fakeToolCall.arguments } as any);
    expect(result).toBeUndefined();
    expect(permissionCallback).toHaveBeenCalledOnce();
    const sent = permissionCallback.mock.calls[0][0];
    expect(sent.toolName).toBe('Read');           // canonical name passed through
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

  it('passes canonical (Claude Code style) tool names straight through to permissionCallback', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const hooks = buildAgentHooks({ permissionCallback });
    const toolNames = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'LS'];
    for (let i = 0; i < toolNames.length; i++) {
      permissionCallback.mockClear();
      await hooks.beforeToolCall!({
        toolCall: { id: 't' + i, name: toolNames[i], arguments: {} },
        args: {},
      } as any);
      expect(permissionCallback.mock.calls[0][0].toolName).toBe(toolNames[i]);
    }
  });

  it('builds a readable detail string for bash command', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const hooks = buildAgentHooks({ permissionCallback });
    await hooks.beforeToolCall!({
      toolCall: { id: 't1', name: 'Bash', arguments: { command: 'ls -la /tmp' } },
      args: { command: 'ls -la /tmp' },
    } as any);
    expect(permissionCallback.mock.calls[0][0].detail).toBe('ls -la /tmp');
  });

  it('lets AskUserQuestion execute through its dedicated interaction tool', async () => {
    const permissionCallback = vi.fn().mockResolvedValue({ behavior: 'deny', message: 'Answer: use WebFetch' });
    const hooks = buildAgentHooks({ permissionCallback });
    const result = await hooks.beforeToolCall!({
      toolCall: { id: 'q1', name: 'AskUserQuestion', arguments: {} },
      args: {
        questions: [
          {
            header: 'Choose the next tool',
            question: 'Which tool should the agent use next?',
            options: [{ label: 'WebFetch', description: 'Fetch a URL' }],
          },
        ],
      },
    } as any);
    expect(result).toBeUndefined();
    expect(permissionCallback).not.toHaveBeenCalled();
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

describe('buildAgentHooks Edit flood advisory', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function callEdit(hooks: any, filePath: string, ok = true) {
    return hooks.afterToolCall({
      toolCall: { id: 't', name: 'Edit', arguments: {} } as any,
      args: { file_path: filePath },
      result: {
        content: [{ type: 'text', text: 'Edited ' + filePath }],
        details: { ok, path: filePath },
      },
      isError: !ok,
      context: {} as any,
    });
  }

  function adviceText(result: { content?: Array<{ type: string; text?: string }> } | undefined): string {
    return (result?.content ?? [])
      .filter(b => b.type === 'text' && typeof b.text === 'string' && b.text.startsWith('[fix]'))
      .map(b => b.text!)
      .join('\n');
  }

  it('stays silent on the first 3 Edits to the same file', async () => {
    const hooks = buildAgentHooks({ permissionCallback: vi.fn() });
    const r1 = await callEdit(hooks, 'a.md');
    const r2 = await callEdit(hooks, 'a.md');
    const r3 = await callEdit(hooks, 'a.md');
    expect(adviceText(r1)).toBe('');
    expect(adviceText(r2)).toBe('');
    expect(adviceText(r3)).toBe('');
    expect(r3?.details?.mutationBudget).toMatchObject({
      tool: 'Edit',
      path: 'a.md',
      attemptsThisTurn: 3,
      advisoryThreshold: 4,
      remainingBeforeAdvisory: 1,
      batchConsumesOneAttempt: true,
    });
  });

  it('appends the [fix] advisory on the 4th Edit to the same file', async () => {
    const hooks = buildAgentHooks({ permissionCallback: vi.fn() });
    for (let i = 0; i < 3; i++) await callEdit(hooks, 'a.md');
    const r4 = await callEdit(hooks, 'a.md');
    const advice = adviceText(r4);
    expect(advice).toMatch(/Edit has now run 4 times against a\.md/);
    expect(advice).toMatch(/MultiEdit/);
    expect(advice).toMatch(/Write|patch/);
  });

  it('counts per file independently', async () => {
    const hooks = buildAgentHooks({ permissionCallback: vi.fn() });
    for (let i = 0; i < 3; i++) await callEdit(hooks, 'a.md');
    const otherFile = await callEdit(hooks, 'b.md');
    expect(adviceText(otherFile)).toBe('');
  });

  it('counts failed Edits too — the advisory is about file-level flooding, not just success', async () => {
    const hooks = buildAgentHooks({ permissionCallback: vi.fn() });
    for (let i = 0; i < 3; i++) await callEdit(hooks, 'a.md', /* ok */ false);
    const r4 = await callEdit(hooks, 'a.md', /* ok */ false);
    expect(adviceText(r4)).toMatch(/Edit has now run 4 times/);
  });

  it('a successful Write clears the counter so post-rewrite Edits start fresh', async () => {
    const hooks = buildAgentHooks({ permissionCallback: vi.fn() });
    for (let i = 0; i < 3; i++) await callEdit(hooks, 'a.md');
    await hooks.afterToolCall!({
      toolCall: { id: 't', name: 'Write', arguments: {} } as any,
      args: { file_path: 'a.md' },
      result: { content: [{ type: 'text', text: 'Wrote a.md' }], details: { ok: true, path: 'a.md' } },
      isError: false,
      context: {} as any,
    } as any);
    const next = await callEdit(hooks, 'a.md');
    expect(adviceText(next)).toBe('');
  });

  it('shouldStopAfterTurn resets the counter so the next turn starts fresh', async () => {
    const hooks = buildAgentHooks({ permissionCallback: vi.fn() });
    for (let i = 0; i < 3; i++) await callEdit(hooks, 'a.md');
    await hooks.shouldStopAfterTurn!({} as any);
    const next = await callEdit(hooks, 'a.md');
    expect(adviceText(next)).toBe('');
  });

  it('respects autoFixHints:false — no advisory even past threshold', async () => {
    const hooks = buildAgentHooks({ permissionCallback: vi.fn(), autoFixHints: false });
    for (let i = 0; i < 5; i++) await callEdit(hooks, 'a.md');
    const r6 = await callEdit(hooks, 'a.md');
    expect(adviceText(r6)).toBe('');
  });
});

describe('buildAgentHooks tool telemetry', () => {
  function makeHooks() {
    return buildAgentHooks({
      permissionCallback: vi.fn().mockResolvedValue({ behavior: 'allow' }),
      autoFixHints: true,
    } as any);
  }

  it('adds telemetry details and an advisory on repeated reads of the same file', async () => {
    const hooks = makeHooks();
    const ctx = () => ({
      toolCall: { name: 'Read' },
      args: { path: 'src/app.ts' },
      result: {
        content: [{ type: 'text', text: 'file body' }],
        details: { ok: true, path: 'src/app.ts' },
      },
    });

    await hooks.afterToolCall!(ctx() as any);
    const second = await hooks.afterToolCall!(ctx() as any);
    const text = (second?.content ?? []).map((block: any) => block.text ?? '').join('\n');

    expect(text).toContain('[telemetry]');
    expect(second?.details?.toolTelemetry).toMatchObject({
      totalCalls: 2,
      toolCounts: { Read: 2 },
      repeatedReads: { 'src/app.ts': 2 },
    });
  });

  it('records Bash routing blocks in telemetry without adding generic remediation', async () => {
    const hooks = makeHooks();
    const result = await hooks.afterToolCall!({
      toolCall: { name: 'Bash' },
      args: { command: 'rg "needle" src' },
      result: {
        content: [{ type: 'text', text: 'Use Grep instead' }],
        details: {
          ok: false,
          error: 'bash_tool_routing_blocked',
          suggestedTool: 'Grep',
          suggestedInput: { pattern: 'needle', path: 'src' },
        },
      },
    } as any);
    const text = (result?.content ?? []).map((block: any) => block.text ?? '').join('\n');

    expect(text).not.toContain('[fix]');
    expect(result?.details?.toolTelemetry).toMatchObject({
      bashRoutingBlocked: 1,
      toolCounts: { Bash: 1 },
    });
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

describe('user hooks integration', () => {
  const allow = () => vi.fn().mockResolvedValue({ behavior: 'allow' });
  const bashCall = { toolCall: { id: 't1', name: 'Bash', arguments: { command: 'git push' } }, args: { command: 'git push' } };

  it('PreToolUse exit-2 hook blocks the tool call with stderr reason', async () => {
    const hooks = buildAgentHooks({
      permissionCallback: allow(),
      userHooks: [{ event: 'PreToolUse', matcher: 'Bash(git *)', command: 'echo "use the release script" >&2; exit 2' }],
      cwd: process.cwd(),
    });
    const result = await hooks.beforeToolCall!(bashCall as any);
    expect(result).toEqual({ block: true, reason: 'use the release script' });
  });

  it('user hooks do not run when permission denies (ordering)', async () => {
    const marker = path.join(os.tmpdir(), `zc-hook-${process.pid}-${Math.random().toString(36).slice(2)}`);
    const hooks = buildAgentHooks({
      permissionCallback: vi.fn().mockResolvedValue({ behavior: 'deny', message: 'no' }),
      userHooks: [{ event: 'PreToolUse', command: `touch "${marker}"` }],
      cwd: process.cwd(),
    });
    const result = await hooks.beforeToolCall!(bashCall as any);
    expect(result).toEqual({ block: true, reason: 'no' });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('non-matching hooks leave the call untouched', async () => {
    const hooks = buildAgentHooks({
      permissionCallback: allow(),
      userHooks: [{ event: 'PreToolUse', matcher: 'Read', command: 'exit 2' }],
      cwd: process.cwd(),
    });
    expect(await hooks.beforeToolCall!(bashCall as any)).toBeUndefined();
  });

  it('hooks receive ORIGINAL args, not the credential-rewritten updatedInput', async () => {
    const capture = path.join(os.tmpdir(), `zc-hook-cap-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    const hooks = buildAgentHooks({
      permissionCallback: vi.fn().mockResolvedValue({ behavior: 'allow', updatedInput: { command: 'echo SECRETPASS | sudo -S x' } }),
      userHooks: [{ event: 'PreToolUse', command: `cat - > "${capture}"` }],
      cwd: process.cwd(),
    });
    const result = await hooks.beforeToolCall!(bashCall as any);
    expect(result).toEqual({ args: { command: 'echo SECRETPASS | sudo -S x' } }); // updatedInput still applied to the TOOL
    const seen = fs.readFileSync(capture, 'utf8');
    expect(seen).toContain('git push');         // hook saw the original
    expect(seen).not.toContain('SECRETPASS');   // hook never saw the credential
    fs.rmSync(capture, { force: true });
  });

  it('appends an auto-fix hint to a recognizable tool failure', async () => {
    const hooks = buildAgentHooks({ permissionCallback: allow() });
    const result = await hooks.afterToolCall!({
      toolCall: { id: 't1', name: 'Edit', arguments: {} },
      args: {},
      result: { content: [{ type: 'text', text: 'old_string not found in file' }], details: { ok: false, error: 'not_found' } },
      isError: false,
      context: {} as any,
    } as any);
    expect(result?.content).toHaveLength(2);
    expect(result?.content[1].text).toMatch(/^\[fix\] .*Read the file again/);
  });

  it('does not append a hint for successful results', async () => {
    const hooks = buildAgentHooks({ permissionCallback: allow() });
    const result = await hooks.afterToolCall!({
      toolCall: { id: 't1', name: 'Edit', arguments: {} },
      args: {},
      result: { content: [{ type: 'text', text: 'Edited f.ts' }], details: { ok: true } },
      isError: false,
      context: {} as any,
    } as any);
    expect(result).toBeUndefined();
  });

  it('respects autoFixHints:false', async () => {
    const hooks = buildAgentHooks({ permissionCallback: allow(), autoFixHints: false });
    const result = await hooks.afterToolCall!({
      toolCall: { id: 't1', name: 'Edit', arguments: {} },
      args: {},
      result: { content: [{ type: 'text', text: 'old_string not found in file' }], details: { ok: false, error: 'not_found' } },
      isError: false,
      context: {} as any,
    } as any);
    expect(result).toBeUndefined();
  });

  it('PostToolUse exit-2 stderr is appended to the tool result content', async () => {
    const hooks = buildAgentHooks({
      permissionCallback: allow(),
      userHooks: [{ event: 'PostToolUse', command: 'echo "lint failed on changed file" >&2; exit 2' }],
      cwd: process.cwd(),
    });
    const result = await hooks.afterToolCall!({
      toolCall: { id: 't1', name: 'Bash', arguments: { command: 'git push' } },
      args: { command: 'git push' },
      result: { content: [{ type: 'text', text: 'pushed' }], details: {} },
      isError: false,
      context: {} as any,
    } as any);
    expect(result?.content).toEqual([
      { type: 'text', text: 'pushed' },
      { type: 'text', text: '[hook] lint failed on changed file' },
    ]);
  });
});

describe('afterToolCall — tool failure loop guard', () => {
  function makeHooks() {
    return buildAgentHooks({
      permissionCallback: vi.fn().mockResolvedValue({ behavior: 'allow' }),
      autoFixHints: true,
    } as any);
  }
  function failingCtx() {
    return {
      toolCall: { name: 'Grep' },
      args: { pattern: 'TODO', path: 'src' },
      result: {
        content: [{ type: 'text', text: 'command failed' }],
        details: { ok: false, error: 'nonzero_exit' },
      },
    };
  }

  it('appends a [loop] nudge and upgrades error on the 3rd identical failure', async () => {
    const hooks = makeHooks();
    await hooks.afterToolCall!(failingCtx() as any);
    await hooks.afterToolCall!(failingCtx() as any);
    const third = await hooks.afterToolCall!(failingCtx() as any);
    const text = (third?.content ?? []).map((b: any) => b.text ?? '').join('\n');
    expect(text).toContain('[loop]');
    expect(third?.details?.error).toBe('tool_loop_detected');
  });

  it('adds a concrete edit recovery plan when identical Edit failures loop', async () => {
    const hooks = makeHooks();
    const ctx = () => ({
      toolCall: { name: 'Edit' },
      args: { file_path: 'src/app.ts', old_string: 'stale text', new_string: 'fresh text' },
      result: {
        content: [{ type: 'text', text: 'old_string not found' }],
        details: { ok: false, error: 'not_found' },
      },
    });

    await hooks.afterToolCall!(ctx() as any);
    await hooks.afterToolCall!(ctx() as any);
    const third = await hooks.afterToolCall!(ctx() as any);
    const text = (third?.content ?? []).map((b: any) => b.text ?? '').join('\n');

    expect(text).toContain('[loop]');
    expect(text).toContain('hashline:true');
    expect(text).toContain('MultiEdit');
    expect(third?.details?.loopRecovery).toMatchObject({
      nextTool: 'Read',
    });
  });

  it('resets the counter on success so a later identical failure does not nudge', async () => {
    const hooks = makeHooks();
    await hooks.afterToolCall!(failingCtx() as any);   // count 1
    await hooks.afterToolCall!(failingCtx() as any);   // count 2
    await hooks.afterToolCall!({                        // success → reset to 0
      toolCall: { name: 'Grep' }, args: { pattern: 'TODO', path: 'src' },
      result: { content: [{ type: 'text', text: 'ok' }], details: { ok: true } },
    } as any);
    const after = await hooks.afterToolCall!(failingCtx() as any); // count 1 if reset worked
    const text = (after?.content ?? []).map((b: any) => b.text ?? '').join('\n');
    expect(text).not.toContain('[loop]');
  });

  it('tracks repeated Bash failures by diagnostics fingerprint', async () => {
    const hooks = makeHooks();
    const bashCtx = (path: string) => ({
      toolCall: { name: 'Bash' },
      args: { command: 'pnpm test' },
      result: {
        content: [{ type: 'text', text: `${path}:1:1 - error TS2322: Type mismatch` }],
        details: {
          ok: false,
          exitCode: 1,
          diagnostics: [
            { path, line: 1, column: 1, severity: 'error', source: 'TS2322', message: 'Type mismatch' },
          ],
        },
      },
    });

    await hooks.afterToolCall!(bashCtx('src/a.ts') as any);
    await hooks.afterToolCall!(bashCtx('src/b.ts') as any);
    const secondA = await hooks.afterToolCall!(bashCtx('src/a.ts') as any);
    expect((secondA?.content ?? []).map((b: any) => b.text ?? '').join('\n')).not.toContain('[loop]');

    const thirdA = await hooks.afterToolCall!(bashCtx('src/a.ts') as any);
    const text = (thirdA?.content ?? []).map((b: any) => b.text ?? '').join('\n');
    expect(text).toContain('[loop]');
    expect(text).toContain('same diagnostics');
    expect(thirdA?.details?.error).toBe('bash_failure_loop_detected');
    expect(thirdA?.details?.loopKind).toBe('bash_failure');
  });

  it('does not add a generic [loop] when a tool already escalated to *_loop_detected', async () => {
    const hooks = makeHooks();
    const editLoopCtx = () => ({
      toolCall: { name: 'Edit' },
      args: { file_path: '/p/a.ts', old_string: 'x' },
      result: {
        content: [{ type: 'text', text: 'edit failed' }],
        details: { ok: false, error: 'edit_loop_detected' },
      },
    });
    // Even after many identical edit-loop-detected results, no generic [loop]
    // is appended and the specific error code is preserved.
    let last: any;
    for (let i = 0; i < 4; i++) last = await hooks.afterToolCall!(editLoopCtx() as any);
    const text = (last?.content ?? []).map((b: any) => b.text ?? '').join('\n');
    expect(text).not.toContain('[loop]');
    // error code is NOT overwritten to tool_loop_detected (when a result obj is returned)
    if (last?.details?.error !== undefined) {
      expect(last.details.error).toBe('edit_loop_detected');
    }
  });
});
