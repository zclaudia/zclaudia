import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionCallback } from '@zclaudia/shared/providers';

const { mockClient, MockCodexAppServerClient } = vi.hoisted(() => {
  const mockClient = {
    currentMode: undefined as string | undefined,
    startThread: vi.fn(async () => 'thread-1'),
    resumeThread: vi.fn(async () => {}),
    runTurn: vi.fn(async function* () {
      yield { type: 'init', sessionId: 'thread-1' };
      yield { type: 'assistant_delta', content: 'ok' };
    }),
    interruptTurn: vi.fn(async () => {}),
    updateExtraArgs: vi.fn(),
    destroy: vi.fn(),
    activeTurns: 0,
    lastActivity: Date.now(),
  };
  return {
    mockClient,
    MockCodexAppServerClient: vi.fn(function MockCodexAppServerClient() {
      return mockClient;
    }),
  };
});

vi.mock('../app-server-client.js', () => ({
  CodexAppServerClient: MockCodexAppServerClient,
}));

const writeMcpConfigMock = vi.hoisted(() =>
  vi.fn(() => ({ configDir: '/tmp/codex-config', configSignature: 'sig-1' }))
);

vi.mock('../config.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../config.js')>();
  return {
    ...original,
    writeMcpConfig: writeMcpConfigMock,
  };
});

import {
  abortCodexSession,
  destroyAllCodexClients,
  resetCodexRunnerForTests,
  runCodexAppServer,
} from '../runner.js';

const denyAll: PermissionCallback = async () => ({ behavior: 'deny' as const });

describe('runner', () => {
  beforeEach(() => {
    resetCodexRunnerForTests();
    MockCodexAppServerClient.mockClear();
    writeMcpConfigMock.mockClear();
    mockClient.startThread.mockClear();
    mockClient.resumeThread.mockClear();
    mockClient.runTurn.mockClear();
    mockClient.interruptTurn.mockClear();
    mockClient.updateExtraArgs.mockClear();
  });

  it('new run calls writeMcpConfig, startThread(cwd), and streams events', async () => {
    const events = [];
    for await (const event of runCodexAppServer(
      'hello',
      { cwd: '/tmp/project', bridge: null },
      denyAll
    )) {
      events.push(event);
    }

    expect(writeMcpConfigMock).toHaveBeenCalledWith(null);
    expect(mockClient.startThread).toHaveBeenCalledWith('/tmp/project');
    expect(mockClient.resumeThread).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: 'init', sessionId: 'thread-1' },
      { type: 'assistant_delta', content: 'ok' },
    ]);
  });

  it('resume with sessionId calls resumeThread', async () => {
    for await (const _event of runCodexAppServer(
      'hello',
      { cwd: '/tmp/project', sessionId: 'existing-thread', bridge: null },
      denyAll
    )) {
      // drain generator
    }

    expect(mockClient.resumeThread).toHaveBeenCalledWith('existing-thread');
    expect(mockClient.startThread).not.toHaveBeenCalled();
  });

  it('abortCodexSession calls interruptTurn', async () => {
    const gen = runCodexAppServer(
      'hello',
      { cwd: '/tmp/project', sessionId: 'thread-1', bridge: null },
      denyAll
    );
    await gen.next();

    await abortCodexSession('thread-1');

    expect(mockClient.interruptTurn).toHaveBeenCalledWith('thread-1');
  });

  afterEach(() => {
    destroyAllCodexClients();
  });
});
