import { EventEmitter } from 'events';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable, Writable } from 'stream';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
import { buildMcpConfigArgs } from '../config.js';
import {
  MAX_APP_SERVER_INBOUND_LINE_BYTES,
  MAX_APP_SERVER_OUTBOUND_LINE_BYTES,
  CodexAppServerClient,
  formatCodexAccount,
  toProviderUsage,
} from '../app-server-client.js';

const spawnMock = vi.mocked(spawn);

type FakeProc = EventEmitter & {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
};

function fakeProc(options: {
  lines?: string[];
  stderrLines?: string[];
  onStdin?: (data: string, stdout: Readable) => void;
  /** Config returned for the session-info `config/read`; omit for an empty one. */
  config?: Record<string, unknown>;
  /** Account returned for the session-info `account/read`. */
  account?: Record<string, unknown>;
}): { proc: FakeProc; stdinWrites: string[] } {
  const stdinWrites: string[] = [];
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });

  const proc = new EventEmitter() as FakeProc;
  proc.stdin = new Writable({
    write(chunk, _enc, cb) {
      const data = chunk.toString();
      stdinWrites.push(data);
      // Every turn asks for the effective config to build session info; answer
      // it here so individual tests only script what they care about.
      for (const line of data.split('\n').filter(Boolean)) {
        let msg: { id?: number; method?: string };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.method === 'model/list') {
          stdout.push(
            JSON.stringify({
              id: msg.id,
              result: {
                data: [
                  {
                    id: 'default-model',
                    model: 'default-model',
                    displayName: 'Default',
                    isDefault: true,
                  },
                ],
                nextCursor: null,
              },
            }) + '\n'
          );
        }
        if (msg.method === 'config/read') {
          stdout.push(
            JSON.stringify({ id: msg.id, result: { config: options.config ?? {} } }) + '\n'
          );
        }
        if (msg.method === 'account/read') {
          stdout.push(
            JSON.stringify({
              id: msg.id,
              result: options.account ?? { account: null, requiresOpenaiAuth: false },
            }) + '\n'
          );
        }
      }
      options.onStdin?.(data, stdout);
      cb();
    },
  });
  proc.stderr = stderr;
  proc.kill = vi.fn(() => {
    proc.killed = true;
    return true;
  });
  proc.killed = false;
  proc.stdout = stdout;

  process.nextTick(() => {
    for (const line of options.stderrLines ?? []) {
      stderr.push(line + '\n');
    }
    for (const line of options.lines ?? []) {
      stdout.push(line + '\n');
    }
  });

  return { proc, stdinWrites };
}

describe('CodexAppServerClient', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('sends effort and restores configured defaults on a subsequent turn', async () => {
    const { proc, stdinWrites } = fakeProc({
      lines: [JSON.stringify({ id: 1, result: { capabilities: {} } })],
      config: { model: 'configured-default' },
      onStdin(data, stdout) {
        for (const line of data.split('\n').filter(Boolean)) {
          const msg = JSON.parse(line);
          if (msg.method !== 'turn/start') continue;
          stdout.push(JSON.stringify({ id: msg.id, result: { turn: { id: 't' } } }) + '\n');
          stdout.push(
            JSON.stringify({
              method: 'turn/completed',
              params: { threadId: 's', turn: { id: 't', status: 'completed' } },
            }) + '\n'
          );
        }
      },
    });
    spawnMock.mockReturnValueOnce(proc as never);
    const client = new CodexAppServerClient('/bin/codex', {});
    await client.ensureRunning();
    for await (const _event of client.runTurn('s', [], async () => ({ behavior: 'deny' }), {
      model: 'chosen',
      thinkingLevel: 'high',
    })) {
      /* drain */
    }
    for await (const _event of client.runTurn('s', [], async () => ({ behavior: 'deny' }), {})) {
      /* drain */
    }
    const starts = stdinWrites
      .flatMap(s =>
        s
          .split('\n')
          .filter(Boolean)
          .map(x => JSON.parse(x))
      )
      .filter(x => x.method === 'turn/start');
    expect(starts.map(x => x.params)).toEqual([
      { threadId: 's', input: [], model: 'chosen', effort: 'high' },
      { threadId: 's', input: [], model: 'configured-default', effort: null },
    ]);
    client.destroy();
  });

  it('re-announces systemInfo with the runtime-reported context window', async () => {
    const tokenUsage = (modelContextWindow: number | null) => ({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 's',
        turnId: 't',
        tokenUsage: { total: {}, last: { inputTokens: 10, outputTokens: 1 }, modelContextWindow },
      },
    });
    const { proc } = fakeProc({
      lines: [JSON.stringify({ id: 1, result: { capabilities: {} } })],
      onStdin(data, stdout) {
        for (const line of data.split('\n').filter(Boolean)) {
          const msg = JSON.parse(line) as { id?: number; method?: string };
          if (msg.method !== 'turn/start') continue;
          stdout.push(JSON.stringify({ id: msg.id, result: { turn: { id: 't' } } }) + '\n');
          // Repeated identical windows must not produce repeated events.
          stdout.push(JSON.stringify(tokenUsage(258_400)) + '\n');
          stdout.push(JSON.stringify(tokenUsage(258_400)) + '\n');
          stdout.push(JSON.stringify(tokenUsage(null)) + '\n');
          stdout.push(
            JSON.stringify({
              method: 'turn/completed',
              params: { threadId: 's', turn: { id: 't', status: 'completed' } },
            }) + '\n'
          );
        }
      },
    });
    spawnMock.mockReturnValueOnce(proc as never);

    const client = new CodexAppServerClient('/bin/codex', {});
    const events = [];
    for await (const event of client.runTurn('s', [], async () => ({
      behavior: 'deny' as const,
    }))) {
      events.push(event);
    }

    const inits = events.filter(e => e.type === 'init');
    expect(inits).toHaveLength(2);
    expect(inits[0].systemInfo?.contextWindow).toBeUndefined();
    expect(inits[1]).toMatchObject({
      systemInfo: { contextWindow: 258_400, contextWindowSource: 'runtime' },
    });
    // A systemInfo update must not re-bind the provider session.
    expect(inits[1].sessionId).toBeUndefined();
    client.destroy();
  });

  it('spawns app-server with stdio listen and extra args', async () => {
    const { proc } = fakeProc({
      lines: [JSON.stringify({ id: 1, result: { capabilities: {} } })],
    });
    spawnMock.mockReturnValueOnce(proc as never);

    const client = new CodexAppServerClient('/bin/codex', {}, ['-c', 'foo=bar']);
    await client.ensureRunning();

    expect(spawnMock).toHaveBeenCalledWith(
      '/bin/codex',
      ['app-server', '--listen', 'stdio://', '-c', 'foo=bar'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
    );
    client.destroy();
  });

  it('runTurn yields init, assistant_delta, and provider_turn_finished', async () => {
    const { proc } = fakeProc({
      lines: [JSON.stringify({ id: 1, result: { capabilities: {} } })],
      onStdin(data, stdout) {
        for (const line of data.split('\n').filter(Boolean)) {
          const msg = JSON.parse(line) as { id?: number; method?: string };
          if (msg.method !== 'turn/start') continue;
          stdout.push(JSON.stringify({ id: msg.id, result: { turn: { id: 'turn-1' } } }) + '\n');
          stdout.push(
            JSON.stringify({
              method: 'item/agentMessage/delta',
              params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'Hi' },
            }) + '\n'
          );
          stdout.push(
            JSON.stringify({
              method: 'thread/tokenUsage/updated',
              params: {
                threadId: 'thread-1',
                turnId: 'turn-1',
                tokenUsage: {
                  total: {},
                  last: {
                    inputTokens: 12,
                    outputTokens: 5,
                    cachedInputTokens: 3,
                    cacheWriteInputTokens: 2,
                    totalTokens: 17,
                    reasoningOutputTokens: 1,
                  },
                },
              },
            }) + '\n'
          );
          stdout.push(
            JSON.stringify({
              method: 'turn/completed',
              params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
            }) + '\n'
          );
        }
      },
    });
    spawnMock.mockReturnValueOnce(proc as never);

    const client = new CodexAppServerClient('/bin/codex', {});
    const events = [];
    for await (const event of client.runTurn(
      'thread-1',
      [{ type: 'text', text: 'hello', text_elements: [] }],
      async () => ({ behavior: 'deny' as const })
    )) {
      events.push(event);
    }

    expect(events.some(e => e.type === 'init' && e.sessionId === 'thread-1')).toBe(true);
    expect(events.some(e => e.type === 'assistant_delta' && e.content === 'Hi')).toBe(true);
    expect(events.some(e => e.type === 'provider_turn_finished' && e.isComplete === true)).toBe(
      true
    );
    // Codex's cachedInputTokens is a subset of inputTokens, so the cached
    // share is subtracted out of `input` (host buckets are disjoint) and the
    // undivided inputTokens is the final call's window occupancy.
    expect(events.find(e => e.type === 'provider_turn_finished')).toMatchObject({
      usage: {
        input: 9,
        output: 5,
        cacheRead: 3,
        cacheWrite: 2,
        totalTokens: 17,
        contextUsedTokens: 12,
      },
    });
    client.destroy();
  });

  it('reports the full session info on init: version, model, perms, auth and MCP servers', async () => {
    const { proc } = fakeProc({
      lines: [
        JSON.stringify({
          id: 1,
          result: {
            userAgent: 'zclaudia/0.154.0 (Mac OS 26.6.2; arm64)',
            codexHome: '/home/.codex',
          },
        }),
      ],
      config: {
        model: 'gpt-5.6-sol',
        mcp_servers: {
          bridge: { command: 'bridge' },
          disabled_one: { command: 'nope', enabled: false },
        },
      },
      account: {
        account: { type: 'chatgpt', email: 'dev@example.com', planType: 'prolite' },
        requiresOpenaiAuth: true,
      },
      onStdin(data, stdout) {
        for (const line of data.split('\n').filter(Boolean)) {
          const msg = JSON.parse(line) as { id?: number; method?: string };
          if (msg.method !== 'turn/start') continue;
          stdout.push(JSON.stringify({ id: msg.id, result: { turn: { id: 'turn-1' } } }) + '\n');
          stdout.push(
            JSON.stringify({
              method: 'turn/completed',
              params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
            }) + '\n'
          );
        }
      },
    });
    spawnMock.mockReturnValueOnce(proc as never);

    const client = new CodexAppServerClient('/bin/codex', {});
    const events = [];
    for await (const event of client.runTurn(
      'thread-1',
      [{ type: 'text', text: 'hello', text_elements: [] }],
      async () => ({ behavior: 'deny' as const }),
      { cwd: '/tmp/project', mode: 'default' }
    )) {
      events.push(event);
    }

    expect(events.find(e => e.type === 'init')?.systemInfo).toEqual({
      cwd: '/tmp/project',
      model: 'gpt-5.6-sol',
      claudeCodeVersion: '0.154.0',
      permissionMode: 'default',
      apiKeySource: 'ChatGPT (prolite)',
      mcpServers: [{ name: 'bridge', status: 'enabled' }],
      tools: [],
    });
    client.destroy();
  });

  it('lets the caller override the reported auth (SDK mode binds its own key)', async () => {
    const { proc } = fakeProc({
      lines: [JSON.stringify({ id: 1, result: { userAgent: 'zclaudia/0.154.0 (linux)' } })],
      account: {
        account: { type: 'chatgpt', email: 'dev@example.com', planType: 'prolite' },
        requiresOpenaiAuth: true,
      },
      onStdin(data, stdout) {
        for (const line of data.split('\n').filter(Boolean)) {
          const msg = JSON.parse(line) as { id?: number; method?: string };
          if (msg.method !== 'turn/start') continue;
          stdout.push(JSON.stringify({ id: msg.id, result: { turn: { id: 'turn-1' } } }) + '\n');
          stdout.push(
            JSON.stringify({
              method: 'turn/completed',
              params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
            }) + '\n'
          );
        }
      },
    });
    spawnMock.mockReturnValueOnce(proc as never);

    const client = new CodexAppServerClient('/bin/codex', {});
    const events = [];
    for await (const event of client.runTurn(
      'thread-1',
      [{ type: 'text', text: 'hello', text_elements: [] }],
      async () => ({ behavior: 'deny' as const }),
      { cwd: '/tmp/project', apiKeySource: 'ZClaudia LLM profile' }
    )) {
      events.push(event);
    }

    expect(events.find(e => e.type === 'init')?.systemInfo).toMatchObject({
      apiKeySource: 'ZClaudia LLM profile',
    });
    client.destroy();
  });

  it('prefers the profile-pinned model over the Codex config default', async () => {
    const { proc } = fakeProc({
      lines: [JSON.stringify({ id: 1, result: { userAgent: 'zclaudia/0.154.0 (linux)' } })],
      config: { model: 'gpt-5.6-sol' },
      onStdin(data, stdout) {
        for (const line of data.split('\n').filter(Boolean)) {
          const msg = JSON.parse(line) as { id?: number; method?: string };
          if (msg.method !== 'turn/start') continue;
          stdout.push(JSON.stringify({ id: msg.id, result: { turn: { id: 'turn-1' } } }) + '\n');
          stdout.push(
            JSON.stringify({
              method: 'turn/completed',
              params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
            }) + '\n'
          );
        }
      },
    });
    spawnMock.mockReturnValueOnce(proc as never);

    const client = new CodexAppServerClient('/bin/codex', {});
    const events = [];
    for await (const event of client.runTurn(
      'thread-1',
      [{ type: 'text', text: 'hello', text_elements: [] }],
      async () => ({ behavior: 'deny' as const }),
      { cwd: '/tmp/project', model: 'gpt-6-astra' }
    )) {
      events.push(event);
    }

    expect(events.find(e => e.type === 'init')?.systemInfo).toMatchObject({
      model: 'gpt-6-astra',
    });
    client.destroy();
  });

  it('emits provider_error and finishes when turn/completed is malformed', async () => {
    const { proc } = fakeProc({
      lines: [JSON.stringify({ id: 1, result: { capabilities: {} } })],
      onStdin(data, stdout) {
        for (const line of data.split('\n').filter(Boolean)) {
          const msg = JSON.parse(line) as { id?: number; method?: string };
          if (msg.method !== 'turn/start') continue;
          stdout.push(JSON.stringify({ id: msg.id, result: { turn: { id: 'turn-1' } } }) + '\n');
          stdout.push(
            JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-1' } }) + '\n'
          );
        }
      },
    });
    spawnMock.mockReturnValueOnce(proc as never);

    const client = new CodexAppServerClient('/bin/codex', {});
    const events = [];
    for await (const event of client.runTurn(
      'thread-1',
      [{ type: 'text', text: 'hello', text_elements: [] }],
      async () => ({ behavior: 'deny' as const })
    )) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: 'provider_error',
      error: 'Codex error: invalid turn/completed notification',
    });
    client.destroy();
  });

  it('interrupts the exact turn returned by turn/start', async () => {
    let notifyTurnStart!: () => void;
    const turnStartSent = new Promise<void>(resolve => {
      notifyTurnStart = resolve;
    });
    let interruptParams: Record<string, unknown> | undefined;
    const { proc } = fakeProc({
      lines: [JSON.stringify({ id: 1, result: { capabilities: {} } })],
      onStdin(data, stdout) {
        for (const line of data.split('\n').filter(Boolean)) {
          const msg = JSON.parse(line) as {
            id?: number;
            method?: string;
            params?: Record<string, unknown>;
          };
          if (msg.method === 'turn/start') {
            stdout.push(
              JSON.stringify({ id: msg.id, result: { turn: { id: 'turn-exact' } } }) + '\n'
            );
            notifyTurnStart();
          } else if (msg.method === 'turn/interrupt') {
            interruptParams = msg.params;
            stdout.push(JSON.stringify({ id: msg.id, result: {} }) + '\n');
            stdout.push(
              JSON.stringify({
                method: 'turn/completed',
                params: {
                  threadId: 'thread-1',
                  turn: { id: 'turn-exact', status: 'interrupted' },
                },
              }) + '\n'
            );
          }
        }
      },
    });
    spawnMock.mockReturnValueOnce(proc as never);

    const client = new CodexAppServerClient('/bin/codex', {});
    const completion = (async () => {
      for await (const _event of client.runTurn(
        'thread-1',
        [{ type: 'text', text: 'wait', text_elements: [] }],
        async () => ({ behavior: 'deny' as const })
      )) {
        /* drain */
      }
    })();

    await turnStartSent;
    await client.interruptTurn('thread-1');
    await completion;

    expect(interruptParams).toEqual({ threadId: 'thread-1', turnId: 'turn-exact' });
    client.destroy();
  });

  it('waits for one shared initialization when callers start concurrently', async () => {
    let initializeId: number | undefined;
    const { proc } = fakeProc({
      onStdin(data) {
        for (const line of data.split('\n').filter(Boolean)) {
          const msg = JSON.parse(line) as { method?: string; id?: number };
          if (msg.method === 'initialize') initializeId = msg.id;
        }
      },
    });
    spawnMock.mockReturnValueOnce(proc as never);

    const client = new CodexAppServerClient('/bin/codex', {});
    const first = client.ensureRunning();
    let secondResolved = false;
    const second = client.ensureRunning().then(() => {
      secondResolved = true;
    });

    await Promise.resolve();
    expect(secondResolved).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    proc.stdout.push(JSON.stringify({ id: initializeId, result: { capabilities: {} } }) + '\n');
    await Promise.all([first, second]);
    client.destroy();
  });

  it('parses JSON-RPC lines split across stdout chunks', async () => {
    const { proc } = fakeProc({});
    spawnMock.mockReturnValueOnce(proc as never);
    const client = new CodexAppServerClient('/bin/codex', {});
    const running = client.ensureRunning();

    await Promise.resolve();
    const response = JSON.stringify({ id: 1, result: { capabilities: {} } }) + '\n';
    proc.stdout.push(response.slice(0, 7));
    proc.stdout.push(response.slice(7));

    await expect(running).resolves.toBeUndefined();
    client.destroy();
  });

  it('ignores valid JSON values that are not JSON-RPC objects', async () => {
    const { proc } = fakeProc({
      lines: ['null', JSON.stringify({ id: 1, result: { capabilities: {} } })],
    });
    spawnMock.mockReturnValueOnce(proc as never);
    const client = new CodexAppServerClient('/bin/codex', {});

    await expect(client.ensureRunning()).resolves.toBeUndefined();
    client.destroy();
  });

  it('terminates app-server when one inbound JSON-RPC line exceeds its byte budget', async () => {
    const { proc } = fakeProc({
      lines: [JSON.stringify({ id: 1, result: { capabilities: {} } })],
    });
    spawnMock.mockReturnValueOnce(proc as never);
    const client = new CodexAppServerClient('/bin/codex', {});
    await client.ensureRunning();

    proc.stdout.push(Buffer.alloc(MAX_APP_SERVER_INBOUND_LINE_BYTES + 1, 0x61));

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    client.destroy();
  });

  it('rejects an outbound JSON-RPC request that exceeds its byte budget', async () => {
    const { proc } = fakeProc({
      lines: [JSON.stringify({ id: 1, result: { capabilities: {} } })],
    });
    spawnMock.mockReturnValueOnce(proc as never);
    const client = new CodexAppServerClient('/bin/codex', {});
    const iterator = client.runTurn(
      'thread-1',
      [
        {
          type: 'text',
          text: 'x'.repeat(MAX_APP_SERVER_OUTBOUND_LINE_BYTES),
          text_elements: [],
        },
      ],
      async () => ({ behavior: 'deny' as const })
    );

    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'init' } });
    await expect(iterator.next()).rejects.toThrow(/request exceeds .* bytes/i);
    client.destroy();
  });

  it('isolates notifications and approval callbacks between concurrent threads', async () => {
    const startedThreads: string[] = [];
    const { proc, stdinWrites } = fakeProc({
      lines: [JSON.stringify({ id: 1, result: { capabilities: {} } })],
      onStdin(data, stdout) {
        for (const line of data.split('\n').filter(Boolean)) {
          const msg = JSON.parse(line) as {
            id?: number;
            method?: string;
            params?: { threadId?: string };
          };
          if (msg.method !== 'turn/start' || !msg.params?.threadId) continue;
          startedThreads.push(msg.params.threadId);
          stdout.push(
            JSON.stringify({
              id: msg.id,
              result: { turn: { id: `turn-${msg.params.threadId}` } },
            }) + '\n'
          );
          if (startedThreads.length !== 2) continue;

          stdout.push(
            JSON.stringify({
              id: 101,
              method: 'item/commandExecution/requestApproval',
              params: {
                threadId: 'thread-a',
                turnId: 'turn-thread-a',
                itemId: 'command-a',
                command: 'command-a',
              },
            }) + '\n'
          );
          stdout.push(
            JSON.stringify({
              id: 102,
              method: 'item/commandExecution/requestApproval',
              params: {
                threadId: 'thread-b',
                turnId: 'turn-thread-b',
                itemId: 'command-b',
                command: 'command-b',
              },
            }) + '\n'
          );
          stdout.push(
            JSON.stringify({
              method: 'item/agentMessage/delta',
              params: { threadId: 'thread-b', turnId: 'turn-thread-b', delta: 'from-b' },
            }) + '\n'
          );
          stdout.push(
            JSON.stringify({
              method: 'item/agentMessage/delta',
              params: { threadId: 'thread-a', turnId: 'turn-thread-a', delta: 'from-a' },
            }) + '\n'
          );
          stdout.push(
            JSON.stringify({
              method: 'turn/completed',
              params: {
                threadId: 'thread-a',
                turn: { id: 'turn-thread-a', status: 'completed' },
              },
            }) + '\n'
          );
          stdout.push(
            JSON.stringify({
              method: 'turn/completed',
              params: {
                threadId: 'thread-b',
                turn: { id: 'turn-thread-b', status: 'completed' },
              },
            }) + '\n'
          );
        }
      },
    });
    spawnMock.mockReturnValueOnce(proc as never);

    const onPermissionA = vi.fn(async () => ({ behavior: 'allow' as const }));
    const onPermissionB = vi.fn(async () => ({ behavior: 'deny' as const }));
    const client = new CodexAppServerClient('/bin/codex', {});
    await client.ensureRunning();

    const eventsA: Array<{ type: string; content?: string }> = [];
    const eventsB: Array<{ type: string; content?: string }> = [];
    await Promise.all([
      (async () => {
        for await (const event of client.runTurn(
          'thread-a',
          [{ type: 'text', text: 'a', text_elements: [] }],
          onPermissionA
        )) {
          eventsA.push(event);
        }
      })(),
      (async () => {
        for await (const event of client.runTurn(
          'thread-b',
          [{ type: 'text', text: 'b', text_elements: [] }],
          onPermissionB
        )) {
          eventsB.push(event);
        }
      })(),
    ]);
    await new Promise(resolve => setImmediate(resolve));

    expect(eventsA).toContainEqual(
      expect.objectContaining({ type: 'assistant_delta', content: 'from-a' })
    );
    expect(eventsA).not.toContainEqual(expect.objectContaining({ content: 'from-b' }));
    expect(eventsB).toContainEqual(
      expect.objectContaining({ type: 'assistant_delta', content: 'from-b' })
    );
    expect(eventsB).not.toContainEqual(expect.objectContaining({ content: 'from-a' }));
    expect(onPermissionA).toHaveBeenCalledWith(
      expect.objectContaining({ toolInput: { command: 'command-a' } })
    );
    expect(onPermissionB).toHaveBeenCalledWith(
      expect.objectContaining({ toolInput: { command: 'command-b' } })
    );

    const responses = stdinWrites
      .flatMap(chunk => chunk.split('\n').filter(Boolean))
      .map(line => JSON.parse(line) as { id?: number; result?: { decision?: string } });
    expect(responses.find(message => message.id === 101)?.result?.decision).toBe('accept');
    expect(responses.find(message => message.id === 102)?.result?.decision).toBe('decline');
    client.destroy();
  });

  it('responds to command approval with accept when callback allows', async () => {
    const approvalLine = JSON.stringify({
      id: 42,
      method: 'item/commandExecution/requestApproval',
      params: { command: 'npm test' },
    });
    const turnCompleted = JSON.stringify({
      method: 'turn/completed',
      params: { turn: { id: 'turn-1', status: 'completed' } },
    });

    const { proc, stdinWrites } = fakeProc({
      lines: [JSON.stringify({ id: 1, result: { capabilities: {} } })],
      onStdin(data, stdout) {
        for (const line of data.split('\n').filter(Boolean)) {
          const msg = JSON.parse(line) as { method?: string; id?: number };
          if (msg.method === 'turn/start') {
            stdout.push(JSON.stringify({ id: msg.id, result: { turn: { id: 'turn-1' } } }) + '\n');
            stdout.push(approvalLine + '\n');
            stdout.push(turnCompleted + '\n');
          }
        }
      },
    });
    spawnMock.mockReturnValueOnce(proc as never);

    const onPermission = vi.fn(async () => ({ behavior: 'allow' as const }));
    const client = new CodexAppServerClient('/bin/codex', {});

    for await (const _ of client.runTurn(
      'thread-1',
      [{ type: 'text', text: 'run tests', text_elements: [] }],
      onPermission
    )) {
      /* drain */
    }

    expect(onPermission).toHaveBeenCalled();
    const approvalResponse = stdinWrites
      .flatMap(chunk => chunk.split('\n').filter(Boolean))
      .map(line => JSON.parse(line) as { id?: number; result?: { decision?: string } })
      .find(msg => msg.id === 42);
    expect(approvalResponse).toEqual({ id: 42, result: { decision: 'accept' } });
    client.destroy();
  });

  it('answers requestUserInput with the hardcoded empty answer set', async () => {
    const { proc, stdinWrites } = fakeProc({
      lines: [JSON.stringify({ id: 1, result: { capabilities: {} } })],
      onStdin(data, stdout) {
        for (const line of data.split('\n').filter(Boolean)) {
          const msg = JSON.parse(line) as { id?: number; method?: string };
          if (msg.method !== 'turn/start') continue;
          stdout.push(JSON.stringify({ id: msg.id, result: { turn: { id: 'turn-1' } } }) + '\n');
          stdout.push(
            JSON.stringify({
              id: 43,
              method: 'item/tool/requestUserInput',
              params: {
                threadId: 'thread-1',
                turnId: 'turn-1',
                itemId: 'item-1',
                questions: [{ id: 'scope', header: 'Scope', question: 'Which scope?' }],
              },
            }) + '\n'
          );
          setImmediate(() =>
            stdout.push(
              JSON.stringify({
                method: 'turn/completed',
                params: {
                  threadId: 'thread-1',
                  turn: { id: 'turn-1', status: 'completed' },
                },
              }) + '\n'
            )
          );
        }
      },
    });
    spawnMock.mockReturnValueOnce(proc as never);
    const onPermission = vi.fn(async () => ({ behavior: 'deny' as const }));
    const client = new CodexAppServerClient('/bin/codex', {});

    for await (const _ of client.runTurn(
      'thread-1',
      [{ type: 'text', text: 'choose scope', text_elements: [] }],
      onPermission
    )) {
      /* drain */
    }

    expect(onPermission).not.toHaveBeenCalled();
    const response = stdinWrites
      .flatMap(chunk => chunk.split('\n').filter(Boolean))
      .map(line => JSON.parse(line) as { id?: number; result?: unknown })
      .find(message => message.id === 43);
    expect(response).toEqual({ id: 43, result: { answers: {} } });
    client.destroy();
  });

  it('isolates approval mode across concurrent threads', async () => {
    const requestIds = new Map([
      ['thread-default', 51],
      ['thread-plan', 52],
    ]);
    const { proc, stdinWrites } = fakeProc({
      lines: [JSON.stringify({ id: 1, result: { capabilities: {} } })],
      onStdin(data, stdout) {
        for (const line of data.split('\n').filter(Boolean)) {
          const msg = JSON.parse(line) as {
            id?: number;
            method?: string;
            params?: { threadId?: string };
          };
          if (msg.method !== 'turn/start' || !msg.params?.threadId) continue;
          const threadId = msg.params.threadId;
          const turnId = `turn-${threadId}`;
          const requestId = requestIds.get(threadId)!;
          stdout.push(JSON.stringify({ id: msg.id, result: { turn: { id: turnId } } }) + '\n');
          setImmediate(() => {
            stdout.push(
              `${JSON.stringify({
                id: requestId,
                method: 'item/commandExecution/requestApproval',
                params: { threadId, turnId, command: 'npm test' },
              })}\n`
            );
            stdout.push(
              `${JSON.stringify({
                method: 'turn/completed',
                params: { threadId, turn: { id: turnId, status: 'completed' } },
              })}\n`
            );
          });
        }
      },
    });
    spawnMock.mockReturnValueOnce(proc as never);
    const client = new CodexAppServerClient('/bin/codex', {});
    await client.ensureRunning();
    const defaultCallback = vi.fn(async () => ({ behavior: 'allow' as const }));
    const planCallback = vi.fn(async () => ({ behavior: 'allow' as const }));
    const drain = async (events: AsyncGenerator<unknown>) => {
      for await (const _event of events) {
        // drain
      }
    };

    await Promise.all([
      drain(
        client.runTurn(
          'thread-default',
          [{ type: 'text', text: 'implement', text_elements: [] }],
          defaultCallback,
          { mode: 'default' }
        )
      ),
      drain(
        client.runTurn(
          'thread-plan',
          [{ type: 'text', text: 'plan', text_elements: [] }],
          planCallback,
          { mode: 'plan' }
        )
      ),
    ]);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(defaultCallback).toHaveBeenCalledTimes(1);
    expect(planCallback).not.toHaveBeenCalled();
    const responses = stdinWrites
      .flatMap(chunk => chunk.split('\n').filter(Boolean))
      .map(line => JSON.parse(line) as { id?: number; result?: { decision?: string } });
    expect(responses).toContainEqual({ id: 51, result: { decision: 'accept' } });
    expect(responses).toContainEqual({ id: 52, result: { decision: 'decline' } });
    client.destroy();
  });

  it('throws clear error when spawn emits ENOENT', async () => {
    const { proc } = fakeProc({ lines: [] });
    spawnMock.mockReturnValueOnce(proc as never);

    const client = new CodexAppServerClient('codex', {});
    const ensurePromise = client.ensureRunning();

    process.nextTick(() => {
      const err = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
      proc.emit('error', err);
    });

    await expect(ensurePromise).rejects.toThrow(/codex CLI not found/i);
    client.destroy();
  });

  it('includes stderr when app-server exits during initialization', async () => {
    const { proc } = fakeProc({
      stderrLines: ['/home/user/.local/bin/zcodex: line 2: exec: codex: not found'],
    });
    spawnMock.mockReturnValueOnce(proc as never);

    const client = new CodexAppServerClient('/home/user/.local/bin/zcodex', {});
    const ensurePromise = client.ensureRunning();

    process.nextTick(() => {
      proc.emit('exit', 127, null);
    });

    await expect(ensurePromise).rejects.toThrow(
      'Codex app-server process exited (code=127): /home/user/.local/bin/zcodex: line 2: exec: codex: not found'
    );
    client.destroy();
  });

  it('logs only override key names, never credential values, when extraArgs change', async () => {
    vi.stubEnv('ZCLAUDIA_CODEX_DEBUG', '1');
    vi.stubEnv('ZCLAUDIA_DATA_DIR', mkdtempSync(join(tmpdir(), 'codex-client-debug-')));
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const initResponse = JSON.stringify({ id: 1, result: { capabilities: {} } });
      const { proc } = fakeProc({ lines: [initResponse] });
      spawnMock.mockReturnValueOnce(proc as never);

      const sensitiveArgs = buildMcpConfigArgs({
        name: 'claudia-plugins',
        config: { command: 'node', env: { BRIDGE_TOKEN: 'sk-live-supersecret' } },
      });
      const client = new CodexAppServerClient('/bin/codex', {}, sensitiveArgs);
      await client.ensureRunning();

      client.updateExtraArgs(['-c', 'approval_policy="on-request"', ...sensitiveArgs]);

      const logged = consoleLogSpy.mock.calls.map(call => call.join(' ')).join('\n');
      expect(logged).toContain('mcp_servers.claudia-plugins.env.BRIDGE_TOKEN');
      expect(logged).not.toContain('sk-live-supersecret');
      client.destroy();
    } finally {
      consoleLogSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('redacts registered credential values from exit-error stderr', async () => {
    buildMcpConfigArgs({
      name: 'claudia-plugins',
      config: { command: 'node', env: { BRIDGE_TOKEN: 'sk-live-supersecret' } },
    });
    const { proc } = fakeProc({
      stderrLines: ['invalid config override: env.BRIDGE_TOKEN="sk-live-supersecret"'],
    });
    spawnMock.mockReturnValueOnce(proc as never);

    const client = new CodexAppServerClient('/bin/codex', {});
    const ensurePromise = client.ensureRunning();

    process.nextTick(() => {
      proc.emit('exit', 1, null);
    });

    const error = await ensurePromise.then(
      () => new Error('expected rejection'),
      (err: Error) => err
    );
    expect(error.message).toContain('[redacted]');
    expect(error.message).not.toContain('sk-live-supersecret');
    client.destroy();
  });

  it('restarts process when updateExtraArgs changes', async () => {
    const initResponse = JSON.stringify({ id: 1, result: { capabilities: {} } });
    const { proc: proc1 } = fakeProc({ lines: [initResponse] });
    const { proc: proc2 } = fakeProc({ lines: [initResponse] });
    spawnMock.mockReturnValueOnce(proc1 as never).mockReturnValueOnce(proc2 as never);

    const client = new CodexAppServerClient('/bin/codex', {}, ['-c', 'old=1']);
    await client.ensureRunning();
    expect(proc1.kill).not.toHaveBeenCalled();

    client.updateExtraArgs(['-c', 'new=2']);
    expect(proc1.kill).toHaveBeenCalled();

    await client.ensureRunning();
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[1][1]).toContain('new=2');

    proc1.emit('exit', 0, null);
    await client.ensureRunning();
    expect(spawnMock).toHaveBeenCalledTimes(2);
    client.destroy();
  });
});

describe('formatCodexAccount', () => {
  it('names the ChatGPT plan, the key, and cloud credentials', () => {
    expect(
      formatCodexAccount({
        account: { type: 'chatgpt', email: null, planType: 'pro' },
        requiresOpenaiAuth: true,
      })
    ).toBe('ChatGPT (pro)');
    expect(
      formatCodexAccount({
        account: { type: 'chatgpt', email: null, planType: 'unknown' },
        requiresOpenaiAuth: true,
      })
    ).toBe('ChatGPT account');
    expect(formatCodexAccount({ account: { type: 'apiKey' }, requiresOpenaiAuth: true })).toBe(
      'API key'
    );
    expect(
      formatCodexAccount({ account: { type: 'amazonBedrock' }, requiresOpenaiAuth: false })
    ).toBe('Amazon Bedrock');
  });

  it('reports an unknown future account type verbatim instead of mislabelling it', () => {
    expect(formatCodexAccount({ account: { type: 'azure' }, requiresOpenaiAuth: true })).toBe(
      'azure'
    );
  });

  it('omits the row when the answer is unknown, and says so when signed out', () => {
    expect(formatCodexAccount(null)).toBeUndefined();
    expect(formatCodexAccount({ account: null, requiresOpenaiAuth: false })).toBeUndefined();
    expect(formatCodexAccount({ account: null, requiresOpenaiAuth: true })).toBe('Signed out');
  });
});

describe('toProviderUsage', () => {
  const breakdown = (over: Record<string, number> = {}) => ({
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    totalTokens: 0,
    reasoningOutputTokens: 0,
    ...over,
  });

  // Shape probed against codex-cli 0.154.0: totalTokens === inputTokens +
  // outputTokens while cachedInputTokens was ~72% of inputTokens, proving the
  // cached count is a subset rather than a separate bucket.
  it('splits the probed overlapping counters into disjoint host buckets', () => {
    expect(
      toProviderUsage(
        breakdown({
          inputTokens: 17_993,
          cachedInputTokens: 12_928,
          outputTokens: 5,
          totalTokens: 17_998,
        })
      )
    ).toMatchObject({
      input: 5_065,
      cacheRead: 12_928,
      output: 5,
      totalTokens: 17_998,
      // input + cacheRead === the final call's real occupancy.
      contextUsedTokens: 17_993,
    });
  });

  it('clamps a cached count that exceeds the input it belongs to', () => {
    const usage = toProviderUsage(breakdown({ inputTokens: 100, cachedInputTokens: 900 }));
    expect(usage.input).toBe(0);
    expect(usage.cacheRead).toBe(100);
  });

  it('omits contextUsedTokens when the call reported no input', () => {
    expect(toProviderUsage(breakdown({ outputTokens: 7 }))).not.toHaveProperty('contextUsedTokens');
  });
});
