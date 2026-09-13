import { mkdir, readFile } from 'fs/promises';
import path from 'path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { runCursorAcp, CURSOR_ACP_TRANSPORT } from '../acp-runner.js';
import type { ProviderRuntimeEvent } from '@zclaudia/plugin-sdk/providers';

const FAKE_CLI = path.join(import.meta.dirname, 'fixtures', 'fake-acp-cli.mjs');
const RECORD_DIR = path.join(import.meta.dirname, 'fixtures', '.record');
let recordSeq = 0;
const spawnedProcesses: Array<{ kill: () => void }> = [];

afterAll(() => {
  for (const proc of spawnedProcesses) proc.kill();
});

interface FakeRunOptions {
  mode: string;
  sessionId?: string;
  providerTransport?: string | null;
  model?: string;
  permissionMode?: string;
  onPermission?: (request: unknown) => Promise<unknown>;
  abortController?: AbortController;
  /** Consume the init event, wait (as the host persists), then resume. */
  pauseAfterInit?: boolean;
  cliPath?: string;
}

interface FakeRunResult {
  events: ProviderRuntimeEvent[];
  wire: Array<Record<string, unknown>>;
}

async function runFake(options: FakeRunOptions): Promise<FakeRunResult> {
  await mkdir(RECORD_DIR, { recursive: true });
  const recordPath = path.join(RECORD_DIR, `record-${Date.now()}-${recordSeq++}.json`);
  const events: ProviderRuntimeEvent[] = [];
  const generator = runCursorAcp('do a thing', {
    cwd: import.meta.dirname,
    cliPath: options.cliPath ?? FAKE_CLI,
    env: { FAKE_ACP_MODE: options.mode, FAKE_ACP_RECORD: recordPath },
    model: options.model,
    mode: options.permissionMode,
    sessionId: options.sessionId,
    providerTransport: options.providerTransport,
    abortController: options.abortController,
    onPermission: options.onPermission as never,
    bridge: null,
  });

  if (options.pauseAfterInit) {
    // Manual iteration: breaking a for-await would close the generator. This
    // mirrors the host exactly — consume the init event, persist "atomically"
    // (here: pause), and only then pull the next event (§14.3).
    const iterator = generator[Symbol.asyncIterator]();
    let recordMidPause: string | undefined;
    while (true) {
      const { value, done } = await iterator.next();
      if (done) break;
      events.push(value);
      if (value.type === 'init') {
        await new Promise(resolve => setTimeout(resolve, 600));
        try {
          recordMidPause = await readFile(recordPath, 'utf8');
        } catch {
          recordMidPause = '';
        }
      }
    }
    // While paused, session/new is on the wire but session/prompt is not.
    expect(recordMidPause).toBeDefined();
    expect(recordMidPause).toContain('session/new');
    expect(recordMidPause).not.toContain('session/prompt');
  } else {
    for await (const event of generator) {
      events.push(event);
    }
  }

  // The fake flushes its wire record every 100ms and on exit; poll briefly
  // instead of racing it once.
  let wire: Array<Record<string, unknown>> = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const raw = await readFile(recordPath, 'utf8');
      wire = raw
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as Record<string, unknown>);
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  return { events, wire };
}

describe('runCursorAcp (fake ACP executable over real stdio)', () => {
  it('runs the happy path: init with transport → text deltas → single terminal', async () => {
    const { events } = await runFake({ mode: 'happy' });
    const init = events.find(e => e.type === 'init');
    expect(init).toMatchObject({
      sessionId: 'fake-session-1',
      providerTransport: CURSOR_ACP_TRANSPORT,
    });
    const text = events
      .filter(e => e.type === 'assistant_delta')
      .map(e => e.content)
      .join('');
    expect(text).toBe('hello world');
    const terminals = events.filter(e => e.type === 'provider_turn_finished');
    expect(terminals).toHaveLength(1);
    expect(terminals[0].isComplete).toBe(true);
  }, 30_000);

  it('does NOT submit the prompt until the consumer resumes past the init yield (§14.3)', async () => {
    const { events, wire } = await runFake({ mode: 'happy', pauseAfterInit: true });
    const newIndex = wire.findIndex(entry => entry.method === 'session/new');
    const promptIndex = wire.findIndex(entry => entry.method === 'session/prompt');
    expect(newIndex).toBeGreaterThan(-1);
    expect(promptIndex).toBeGreaterThan(newIndex);
    expect(events.some(e => e.type === 'init')).toBe(true);
    expect(events.some(e => e.type === 'provider_turn_finished')).toBe(true);
  }, 30_000);

  it('renders a denied tool call as an error even though the agent reported completed (§9.2)', async () => {
    const onPermission = vi.fn().mockResolvedValue({ behavior: 'deny' });
    const { events, wire } = await runFake({ mode: 'deny-completed', onPermission });
    const finished = events.find(e => e.type === 'tool_finished');
    expect(finished).toBeDefined();
    expect(finished!.isToolError).toBe(true);
    expect(String(finished!.toolResult)).toContain('Denied by user');
    const permissionReplies = wire.filter(entry =>
      String(entry.clientResponseFor ?? '').startsWith('perm-')
    );
    expect(permissionReplies).toHaveLength(1);
    expect(
      (permissionReplies[0].result as { outcome: { optionId: string } }).outcome.optionId
    ).toBe('reject-once');
  }, 30_000);

  it('never shows the MCP placeholder tool title (§9.1)', async () => {
    const onPermission = vi.fn().mockResolvedValue({ behavior: 'allow' });
    const { events } = await runFake({ mode: 'mcp-placeholder', onPermission });
    const started = events.find(e => e.type === 'tool_started');
    expect(started!.toolName).toBe('zclaudia-probe: probe_ping');
    expect(JSON.stringify(events)).not.toContain('"MCP: tool"');
  }, 30_000);

  it('bypass mode auto-approves with allow_once and never calls the host callback', async () => {
    const onPermission = vi.fn();
    const { events, wire } = await runFake({
      mode: 'bypass-allow',
      permissionMode: 'bypassPermissions',
      onPermission,
    });
    expect(onPermission).not.toHaveBeenCalled();
    const reply = wire.find(entry => String(entry.clientResponseFor ?? '').startsWith('perm-'))
      ?.result as {
      outcome: { optionId?: string };
    };
    expect(reply.outcome.optionId).toBe('allow-once');
    expect(events.at(-1)?.type).toBe('provider_turn_finished');
  }, 30_000);

  it('cancels cleanly on abort: cancel notification sent, turn converges without terminal', async () => {
    const controller = new AbortController();
    const runPromise = (async () => {
      const events: ProviderRuntimeEvent[] = [];
      for await (const event of runCursorAcp('long task', {
        cwd: import.meta.dirname,
        cliPath: FAKE_CLI,
        env: { FAKE_ACP_MODE: 'hang' },
        abortController: controller,
        bridge: null,
      })) {
        events.push(event);
      }
      return events;
    })();
    await new Promise(resolve => setTimeout(resolve, 600));
    controller.abort();
    const events = await runPromise;
    expect(events.some(e => e.type === 'provider_turn_finished')).toBe(false);
    expect(events.filter(e => e.type === 'error')).toHaveLength(0);
  }, 30_000);

  it('forces shutdown after a bounded grace when the agent ignores cancellation', async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const runPromise = runFake({ mode: 'ignore-cancel', abortController: controller });
    await new Promise(resolve => setTimeout(resolve, 600));
    controller.abort();
    const { events, wire } = await runPromise;
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(wire.some(entry => entry.method === 'session/cancel')).toBe(true);
    expect(events.some(event => event.type === 'provider_turn_finished')).toBe(false);
    expect(events.some(event => event.type === 'error')).toBe(false);
  }, 10_000);

  it('suppresses load replay and does not duplicate history into the turn (§7.3)', async () => {
    const { events } = await runFake({
      mode: 'load-replay',
      sessionId: 'fake-session-1',
      providerTransport: CURSOR_ACP_TRANSPORT,
    });
    const text = events
      .filter(e => e.type === 'assistant_delta')
      .map(e => e.content)
      .join('');
    expect(text).toBe('fresh answer');
    expect(text).not.toContain('old answer');
    expect(
      events.some(e => e.type === 'thinking_delta' && e.thinkingContent === 'old thought')
    ).toBe(false);
    expect(events.filter(e => e.type === 'provider_turn_finished')).toHaveLength(1);
  }, 30_000);

  it('refuses to resume a legacy-transport session over ACP without spawning (§14.4)', async () => {
    const { events, wire } = await runFake({
      mode: 'happy',
      sessionId: 'legacy-session',
      providerTransport: 'cursor-stream-json-v1',
    });
    const error = events.find(e => e.type === 'error');
    expect(error).toBeDefined();
    expect(error!.errorCode).toBe('CURSOR_SESSION_NOT_FOUND');
    expect(error!.error).toContain('legacy');
    expect(wire).toEqual([]);
  }, 30_000);

  it('fails a missing ACP load with CURSOR_SESSION_NOT_FOUND and never falls back to session/new', async () => {
    const { events, wire } = await runFake({
      mode: 'load-not-found',
      sessionId: 'gone-session',
      providerTransport: CURSOR_ACP_TRANSPORT,
    });
    const error = events.find(e => e.type === 'error');
    expect(error!.errorCode).toBe('CURSOR_SESSION_NOT_FOUND');
    expect(wire.some(entry => entry.method === 'session/load')).toBe(true);
    expect(wire.some(entry => entry.method === 'session/new')).toBe(false);
  }, 30_000);

  it('sends the parameterized modelId for a bare model name and reports both (§7.4)', async () => {
    const { events, wire } = await runFake({ mode: 'model-check', model: 'fake-model' });
    const setModel = wire.find(entry => entry.method === 'session/set_model');
    expect(setModel).toMatchObject({ params: { modelId: 'fake-model[thinking=true,context=9k]' } });
    const init = events.find(e => e.type === 'init');
    expect(init!.systemInfo).toMatchObject({
      model: 'fake-model',
      modelId: 'fake-model[thinking=true,context=9k]',
    });
  }, 30_000);

  it('fails fast on an unsupported explicit model (§7.4)', async () => {
    const { events, wire } = await runFake({ mode: 'model-check', model: 'does-not-exist' });
    const error = events.find(e => e.type === 'error');
    expect(error!.errorCode).toBe('CURSOR_MODEL_UNSUPPORTED');
    expect(wire.some(entry => entry.method === 'session/prompt')).toBe(false);
  }, 30_000);

  it('fails with CURSOR_ACP_MODE_UNSUPPORTED when the requested mode is not offered (§8.1)', async () => {
    const { events, wire } = await runFake({ mode: 'mode-unsupported', permissionMode: 'plan' });
    const error = events.find(e => e.type === 'error');
    expect(error!.errorCode).toBe('CURSOR_ACP_MODE_UNSUPPORTED');
    expect(wire.some(entry => entry.method === 'session/prompt')).toBe(false);
  }, 30_000);

  it('answers cursor/ask_question with a formal skipped outcome and the turn survives (§10.1)', async () => {
    const { events, wire } = await runFake({ mode: 'ask-skip' });
    const text = events
      .filter(e => e.type === 'assistant_delta')
      .map(e => e.content)
      .join('');
    expect(text).toContain('ASK:skipped');
    expect(
      wire.some(
        entry =>
          JSON.stringify(entry.askQuestionResult) ===
          JSON.stringify({
            outcome: {
              outcome: 'skipped',
              reason: 'ZClaudia does not support structured questions for this runtime yet.',
            },
          })
      )
    ).toBe(true);
    expect(events.at(-1)?.type).toBe('provider_turn_finished');
  }, 30_000);

  it('routes cursor/create_plan through the permission callback and reports the outcome (§10.1)', async () => {
    const onPermission = vi.fn(async request => {
      expect((request as { toolName: string }).toolName).toBe('createPlan');
      return { behavior: 'allow' };
    });
    const { events, wire } = await runFake({ mode: 'create-plan', onPermission });
    const text = events
      .filter(e => e.type === 'assistant_delta')
      .map(e => e.content)
      .join('');
    expect(text).toContain('PLAN:accepted');
    expect(
      wire.some(
        entry =>
          entry.createPlanOutcome === 'accepted' &&
          JSON.stringify(entry.createPlanResult) ===
            JSON.stringify({ outcome: { outcome: 'accepted' } })
      )
    ).toBe(true);
  }, 30_000);

  it('declines cursor/create_plan when the host denies, failing closed', async () => {
    const onPermission = vi.fn().mockResolvedValue({ behavior: 'deny' });
    const { events } = await runFake({ mode: 'create-plan', onPermission });
    const text = events
      .filter(e => e.type === 'assistant_delta')
      .map(e => e.content)
      .join('');
    expect(text).toContain('PLAN:rejected');
  }, 30_000);

  it('flags a mutating tool that executes without permission in plan mode as a protocol violation (§8.3)', async () => {
    const { events } = await runFake({ mode: 'never-permitted', permissionMode: 'plan' });
    const error = events.find(e => e.type === 'error');
    expect(error).toBeDefined();
    expect(error!.errorCode).toBe('CURSOR_PERMISSION_PROTOCOL_ERROR');
    const toolFinished = events.find(e => e.type === 'tool_finished');
    expect(toolFinished!.isToolError).toBe(true);
  }, 30_000);

  it('fails with CURSOR_ACP_UNSUPPORTED on a missing executable and never starts the legacy runner', async () => {
    const { events } = await runFake({
      mode: 'happy',
      cliPath: '/nonexistent/cursor-agent-binary',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0].errorCode).toBe('CURSOR_ACP_UNSUPPORTED');
  }, 30_000);
});
