import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { runClaudeAgent, type ClaudeAgentRunOptions } from '../runner.js';

const { queryMock, spawnMock } = vi.hoisted(() => ({ queryMock: vi.fn(), spawnMock: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('../resolve-cli.js', () => ({
  inspectClaudeCli: () => ({ status: 'supported' }),
  resolveClaudeCliFromPath: () => '/fixture/claude',
}));

afterEach(() => vi.resetAllMocks());

it.each(['cli', 'sdk'] as const)('cancels only the owning query process in %s mode', async mode => {
  const children = [0, 1].map(() =>
    Object.assign(new EventEmitter(), {
      kill: vi.fn(),
      killed: true, // The SDK already sent SIGTERM, but the process is still alive.
      exitCode: null,
      signalCode: null,
    })
  );
  spawnMock.mockReturnValueOnce(children[0]).mockReturnValueOnce(children[1]);
  const streams: { close: ReturnType<typeof vi.fn> }[] = [];
  queryMock.mockImplementation(({ options }) => {
    options.spawnClaudeCodeProcess({
      command: '/fixture/claude',
      args: ['--output-format', 'stream-json'],
      cwd: options.cwd,
      env: {},
      signal: options.abortController.signal,
    });
    let finish!: () => void;
    const stopped = new Promise<void>(resolve => {
      finish = resolve;
    });
    const stream = {
      close: vi.fn(finish),
      applyFlagSettings: vi.fn(async () => {}),
      async *[Symbol.asyncIterator]() {
        yield { type: 'system', subtype: 'init', session_id: `session-${streams.length}` };
        await stopped;
      },
    };
    streams.push(stream);
    return stream;
  });
  const options: ClaudeAgentRunOptions = {
    cwd: '/project',
    cliPath: '/fixture/claude',
    ...(mode === 'sdk'
      ? ({
          engineExecution: {
            engineMode: 'sdk',
            executableSource: 'bundled-sdk',
            configDirectory: '/isolated',
          },
          modelConnection: {
            protocol: 'anthropic-messages',
            baseUrl: 'https://bound.example',
            apiKey: 'test-key',
          },
        } as const)
      : {}),
  };
  const firstAbort = new AbortController();
  const secondAbort = new AbortController();
  const first = runClaudeAgent('first', { ...options, abortController: firstAbort });
  const second = runClaudeAgent('second', { ...options, abortController: secondAbort });
  try {
    await first.next();
    await second.next();
    firstAbort.abort();
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL');
    expect(children[1].kill).not.toHaveBeenCalled();
    expect(streams[0].close).toHaveBeenCalled();
    expect(streams[1].close).not.toHaveBeenCalled();
    expect(secondAbort.signal.aborted).toBe(false);
    await first.next();
    // A process that already exited must not receive a late cancellation signal.
    children[1].emit('exit', null, 'SIGTERM');
    secondAbort.abort();
    expect(children[1].kill).not.toHaveBeenCalled();
    await second.next();
  } finally {
    for (const stream of streams) stream.close();
    await first.return();
    await second.return();
  }
});
