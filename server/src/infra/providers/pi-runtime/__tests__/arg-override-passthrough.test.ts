import { describe, it, expect, vi } from 'vitest';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { validateToolArguments } from '@earendil-works/pi-ai';
import { buildAgentHooks } from '../agent-hooks.js';
import { buildTools } from '../tool-bridge.js';
import { buildPiRunToolBundle } from '../run-tools.js';
import {
  PendingArgOverrides,
  withPendingArgOverrides,
  DEFAULT_OVERRIDE_TTL_MS,
} from '../pending-arg-overrides.js';

/**
 * End-to-end regression for quality-audit P0-1 (docs/quality-audit/07-agent-tools.md):
 * pi-agent-core honors only `block`/`reason` from BeforeToolCallResult — a
 * returned `{ args }` (permission `updatedInput`, e.g. the sudo credential
 * rewrite) is silently dropped and the tool executes with the ORIGINAL args.
 *
 * These tests drive the exact call order pi's agent loop uses
 * (dist/agent-loop.js prepareToolCall → executePreparedToolCall):
 *
 *   validatedArgs = validateToolArguments(tool, toolCall)          // pi
 *   beforeResult  = await hooks.beforeToolCall({ toolCall, args }) // pi
 *   if (!beforeResult?.block)
 *     await tool.execute(toolCall.id, validatedArgs, signal)       // pi
 *
 * and prove the rewrite now reaches the tool via the per-run override store.
 */

type ExecuteParams = Parameters<AgentTool['execute']>[1];

interface CapturedCall {
  toolCallId: string;
  params: ExecuteParams;
}

/** A stub Bash-shaped tool with a real JSON-schema parameter contract. */
function createStubBashTool(captured: CapturedCall[]): AgentTool {
  return {
    name: 'Bash',
    label: 'Bash',
    description: 'stub bash for tests',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout: { type: 'number' },
      },
      required: ['command'],
      additionalProperties: false,
       
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      captured.push({ toolCallId, params });
      return { content: [{ type: 'text', text: 'ok' }], details: { ok: true } };
    },
  };
}

function buildBundle(options: {
  permissionCallback: (req: unknown) => Promise<{
    behavior: 'allow' | 'deny';
    message?: string;
    updatedInput?: unknown;
  }>;
  captured: CapturedCall[];
}) {
  const argOverrides = new PendingArgOverrides();
  const stub = createStubBashTool(options.captured);
  const tools = buildTools('/tmp', {
    enabled: ['Bash'],
    overrides: { bash: stub },
    argOverrides,
  });
  const bash = tools.find(t => t.name === 'Bash')!;
  const hooks = buildAgentHooks({
     
    permissionCallback: options.permissionCallback as any,
    argOverrides,
  });
  return { bash, hooks, argOverrides };
}

/**
 * Mirror pi agent-loop.js exactly: prepareArguments → validateToolArguments →
 * beforeToolCall → (unless blocked) tool.execute(toolCall.id, validatedArgs).
 */
async function runPiToolCallOrder(
  tool: AgentTool,
  hooks: ReturnType<typeof buildAgentHooks>,
  toolCall: { id: string; name: string; arguments: Record<string, unknown> }
): Promise<'blocked' | 'executed'> {
   
  const validatedArgs = validateToolArguments(tool, toolCall as any);
   
  const beforeResult = await hooks.beforeToolCall!({ toolCall, args: validatedArgs } as any);
  if (beforeResult?.block) return 'blocked';
  await tool.execute(toolCall.id, validatedArgs);
  return 'executed';
}

describe('updatedInput end-to-end passthrough (P0-1 regression)', () => {
  it('permission-approved updatedInput reaches tool execute (sudo credential rewrite shape)', async () => {
    const captured: CapturedCall[] = [];
    const { bash, hooks } = buildBundle({
      captured,
      permissionCallback: async () => ({
        behavior: 'allow',
        updatedInput: { command: 'echo SECRETPASS | sudo -S apt-get update' },
      }),
    });

    const outcome = await runPiToolCallOrder(bash, hooks, {
      id: 'call-1',
      name: 'Bash',
      arguments: { command: 'sudo apt-get update' },
    });

    expect(outcome).toBe('executed');
    expect(captured).toHaveLength(1);
    // THE regression assertion: the REWRITTEN command, not the original.
    expect(captured[0].params).toEqual({ command: 'echo SECRETPASS | sudo -S apt-get update' });
  });

  it('plain-allow calls execute with the ORIGINAL args (no substitution)', async () => {
    const captured: CapturedCall[] = [];
    const { bash, hooks } = buildBundle({
      captured,
      permissionCallback: async () => ({ behavior: 'allow' }),
    });

    await runPiToolCallOrder(bash, hooks, {
      id: 'call-1',
      name: 'Bash',
      arguments: { command: 'ls -la' },
    });

    expect(captured[0].params).toEqual({ command: 'ls -la' });
  });

  it('overrides are one-shot and do not leak across calls', async () => {
    const captured: CapturedCall[] = [];
    // First call gets a rewrite; subsequent calls are plain allows.
    const permissionCallback = vi
      .fn()
      .mockResolvedValueOnce({
        behavior: 'allow',
        updatedInput: { command: 'rewritten-command' },
      })
      .mockResolvedValue({ behavior: 'allow' });
    const { bash, hooks, argOverrides } = buildBundle({ captured, permissionCallback });

    await runPiToolCallOrder(bash, hooks, {
      id: 'call-1',
      name: 'Bash',
      arguments: { command: 'original-1' },
    });
    // A later, unrelated call must not inherit the rewrite.
    await runPiToolCallOrder(bash, hooks, {
      id: 'call-2',
      name: 'Bash',
      arguments: { command: 'original-2' },
    });

    expect(captured[0].params).toEqual({ command: 'rewritten-command' });
    expect(captured[1].params).toEqual({ command: 'original-2' });
    expect(argOverrides.size).toBe(0); // consumed, not leaked
  });

  it('parallel calls in one run each get their own override (keyed by tool-call id)', async () => {
    const captured: CapturedCall[] = [];
    const permissionCallback = vi.fn().mockImplementation(async (req: { toolInput: unknown }) => ({
      behavior: 'allow',
      updatedInput: {
        command: `rewritten:${(req.toolInput as { command: string }).command}`,
      },
    }));
    const { bash, hooks } = buildBundle({ captured, permissionCallback });

    // pi parallel mode awaits every prepareToolCall (→ beforeToolCall) before
    // executing; record order differs from execute order, so the store must be
    // keyed correctly. Drive both calls' hooks first, then execute in reverse.
     
    const argsA = validateToolArguments(bash, { id: 'A', name: 'Bash', arguments: { command: 'a' } } as any);
     
    const argsB = validateToolArguments(bash, { id: 'B', name: 'Bash', arguments: { command: 'b' } } as any);
     
    await hooks.beforeToolCall!({ toolCall: { id: 'A', name: 'Bash' }, args: argsA } as any);
     
    await hooks.beforeToolCall!({ toolCall: { id: 'B', name: 'Bash' }, args: argsB } as any);

    await bash.execute('B', argsB);
    await bash.execute('A', argsA);

    expect(captured[0]).toEqual({ toolCallId: 'B', params: { command: 'rewritten:b' } });
    expect(captured[1]).toEqual({ toolCallId: 'A', params: { command: 'rewritten:a' } });
  });

  it('a rewrite that violates the tool schema is rejected (fail-closed, mirrors pi validation)', async () => {
    const captured: CapturedCall[] = [];
    const { bash, hooks } = buildBundle({
      captured,
      permissionCallback: async () => ({
        behavior: 'allow',
        // An object can never satisfy `command: string`. (Note: scalar
        // mismatches like `{command: 123}` are COERCED to strings by
        // Value.Convert inside validateToolArguments — that is pi's exact
        // behavior for model-supplied args too, so we mirror it rather than
        // being stricter.)
        updatedInput: { command: { unexpected: 'object' } },
      }),
    });

     
    const validatedArgs = validateToolArguments(bash, {
      id: 'call-1',
      name: 'Bash',
      arguments: { command: 'sudo x' },
       
    } as any);
     
    await hooks.beforeToolCall!({ toolCall: { id: 'call-1', name: 'Bash' }, args: validatedArgs } as any);

    // pi's executePreparedToolCall catches this throw and turns it into an
    // error tool result — the invalid rewrite never executes.
    await expect(bash.execute('call-1', validatedArgs)).rejects.toThrow(/Validation failed/);
    expect(captured).toHaveLength(0);
  });

  it('a denied call records nothing in the store', async () => {
    const captured: CapturedCall[] = [];
    const { bash, hooks, argOverrides } = buildBundle({
      captured,
      permissionCallback: async () => ({ behavior: 'deny', message: 'no' }),
    });

    const outcome = await runPiToolCallOrder(bash, hooks, {
      id: 'call-1',
      name: 'Bash',
      arguments: { command: 'rm -rf /' },
    });

    expect(outcome).toBe('blocked');
    expect(captured).toHaveLength(0);
    expect(argOverrides.size).toBe(0);
  });

  it('buildPiRunToolBundle wires one shared store: rewrite is observable in the tool RESULT', async () => {
    // Full production wiring (bundle → buildTools + buildAgentHooks), asserted
    // behaviorally: Glob executes with the REWRITTEN pattern, so the result
    // contains the file that only the rewrite can match. Uses Glob to avoid
    // spawning processes; tempdir keeps it hermetic.
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-arg-override-'));
    fs.writeFileSync(path.join(dir, 'alpha-target.txt'), 'x');

    const bundle = buildPiRunToolBundle({
      options: { cwd: dir } as never,
      effectiveTools: ['Glob'],
      supportsVision: false,
      isPlanMode: false,
      permissionCallback: (async () => ({
        behavior: 'allow',
        updatedInput: { pattern: 'alpha-*.txt' },
         
      })) as any,
    });
    const glob = bundle.tools.find(t => t.name === 'Glob')!;
    const toolCall = { id: 'call-bundle', name: 'Glob', arguments: { pattern: 'nomatch-*.zzz' } };
     
    const validatedArgs = validateToolArguments(glob, toolCall as any);
     
    const beforeResult = await bundle.hooks.beforeToolCall!({ toolCall, args: validatedArgs } as any);
    expect(beforeResult?.block).toBeFalsy();

    const result = await glob.execute(toolCall.id, validatedArgs);
    const rendered = JSON.stringify(result);
    // Original pattern matches nothing; only the REWRITTEN pattern can hit.
    expect(rendered).toContain('alpha-target.txt');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('PendingArgOverrides store', () => {
  it('consume is one-shot', () => {
    const store = new PendingArgOverrides();
    store.record('id-1', { a: 1 });
    expect(store.consume('id-1')).toEqual({ a: 1 });
    expect(store.consume('id-1')).toBeUndefined();
  });

  it('expires entries past the TTL (leak safety for aborted calls)', () => {
    let now = 1_000;
    const store = new PendingArgOverrides(() => now, 100);
    store.record('id-1', { a: 1 });
    now += 101;
    expect(store.consume('id-1')).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('sweeps expired entries on record', () => {
    let now = 1_000;
    const store = new PendingArgOverrides(() => now, 100);
    store.record('stale', { a: 1 });
    now += 200;
    store.record('fresh', { b: 2 });
    expect(store.size).toBe(1);
    expect(store.consume('stale')).toBeUndefined();
    expect(store.consume('fresh')).toEqual({ b: 2 });
  });

  it('bounds the number of pending entries', () => {
    const store = new PendingArgOverrides();
    for (let i = 0; i < 300; i++) store.record(`id-${i}`, { i });
    expect(store.size).toBeLessThanOrEqual(256);
    // Oldest evicted; newest retained.
    expect(store.consume('id-0')).toBeUndefined();
    expect(store.consume('id-299')).toEqual({ i: 299 });
  });

  it('withPendingArgOverrides passes through when no override is pending', async () => {
    const captured: CapturedCall[] = [];
    const stub = createStubBashTool(captured);
    const wrapped = withPendingArgOverrides(stub, new PendingArgOverrides());
    await wrapped.execute('nope', { command: 'plain' });
    expect(captured[0].params).toEqual({ command: 'plain' });
  });

  it('default TTL constant is 5 minutes', () => {
    expect(DEFAULT_OVERRIDE_TTL_MS).toBe(5 * 60 * 1000);
  });
});
