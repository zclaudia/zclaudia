import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runAdapterConformanceSuite } from '../../../../../scripts/plugins/runtime-conformance.mjs';

const runCursorMock = vi.fn(async function* () {
  yield { type: 'init', sessionId: 'prov-1' } as const;
});
const abortCursorSessionMock = vi.fn(async () => {});
const runCursorAcpMock = vi.fn(async function* () {
  yield { type: 'init', sessionId: 'acp-prov-1', providerTransport: 'cursor-acp-v1' } as const;
});

vi.mock('../runner.js', () => ({
  runCursor: (...args: unknown[]) => runCursorMock(...args),
  abortCursorSession: (...args: unknown[]) => abortCursorSessionMock(...args),
}));

vi.mock('../acp-runner.js', () => ({
  CURSOR_ACP_TRANSPORT: 'cursor-acp-v1',
  runCursorAcp: (...args: unknown[]) => runCursorAcpMock(...args),
}));

import { CURSOR_STREAM_JSON_TRANSPORT, CursorAgentAdapter } from '../adapter.js';

const LEGACY_ENV = { ZCLAUDIA_CURSOR_TRANSPORT: 'stream-json' };

describe('CursorAgentAdapter', () => {
  beforeEach(() => {
    runCursorMock.mockClear();
    runCursorAcpMock.mockClear();
    abortCursorSessionMock.mockClear();
  });

  it('registers type cursor', () => {
    expect(new CursorAgentAdapter(async () => null).type).toBe('cursor');
  });

  it('satisfies the shared normalized event-stream contract', async () => {
    runCursorMock.mockImplementationOnce(async function* () {
      yield { type: 'init', sessionId: 'cursor-session' };
      yield { type: 'assistant', content: 'hello from Cursor' };
      yield { type: 'result', isComplete: true };
    });
    const suite = await runAdapterConformanceSuite({
      adapter: new CursorAgentAdapter(async () => null),
      input: 'hello',
      context: {
        cwd: '/tmp/project',
        claudiaSessionId: 'session-1',
        serverPort: 3100,
        env: LEGACY_ENV,
      },
      onPermission: vi.fn(),
    });
    expect(suite.passed).toBe(true);
  });

  it('calls createToolBridge and passes bridge into runCursor', async () => {
    const bridge = { name: 'claudia-plugins', config: { command: 'node' } };
    const createToolBridge = vi.fn(async () => bridge);
    const adapter = new CursorAgentAdapter(createToolBridge);
    for await (const _ of adapter.run(
      'hi',
      {
        cwd: '/p',
        claudiaSessionId: 'sess',
        serverPort: 3100,
        mode: 'default',
        env: LEGACY_ENV,
      },
      vi.fn()
    )) {
      /* drain */
    }
    expect(createToolBridge).toHaveBeenCalledWith({
      serverPort: 3100,
      sessionId: 'sess',
    });
    expect(runCursorMock).toHaveBeenCalledWith(
      'hi',
      expect.objectContaining({ cwd: '/p', bridge, mode: 'default' })
    );
  });

  it('passes the persisted provider session to Cursor for resume', async () => {
    const adapter = new CursorAgentAdapter(async () => null);

    for await (const _ of adapter.run(
      'continue',
      {
        cwd: '/p',
        sessionId: 'provider-existing',
        providerTransport: CURSOR_STREAM_JSON_TRANSPORT,
        claudiaSessionId: 'client-session',
      },
      vi.fn()
    )) {
      // drain
    }

    expect(runCursorMock).toHaveBeenCalledWith(
      'continue',
      expect.objectContaining({ sessionId: 'provider-existing', cwd: '/p' })
    );
  });

  it('uses setSessionMode over context.mode for the next turn', async () => {
    const adapter = new CursorAgentAdapter(async () => null);
    adapter.setSessionMode('sess', 'plan');
    for await (const _ of adapter.run(
      'hi',
      { cwd: '/p', claudiaSessionId: 'sess', mode: 'default', env: LEGACY_ENV },
      vi.fn()
    )) {
      /* drain */
    }
    expect(runCursorMock).toHaveBeenCalledWith('hi', expect.objectContaining({ mode: 'plan' }));
  });

  it('uses provider mode transitions for the next resumed turn', async () => {
    runCursorMock.mockImplementationOnce(async function* () {
      yield { type: 'init', sessionId: 'provider-1' };
      yield {
        type: 'mode_transition',
        modeTransition: { mode: 'plan', reason: 'enter' },
      };
    });
    const adapter = new CursorAgentAdapter(async () => null);
    for await (const _ of adapter.run(
      'plan it',
      { cwd: '/p', claudiaSessionId: 'sess', mode: 'default', env: LEGACY_ENV },
      vi.fn()
    )) {
      /* drain */
    }
    runCursorMock.mockClear();
    for await (const _ of adapter.run(
      'continue',
      {
        cwd: '/p',
        sessionId: 'provider-1',
        providerTransport: CURSOR_STREAM_JSON_TRANSPORT,
        claudiaSessionId: 'sess',
        mode: 'default',
      },
      vi.fn()
    )) {
      /* drain */
    }
    expect(runCursorMock).toHaveBeenCalledWith(
      'continue',
      expect.objectContaining({ mode: 'plan' })
    );
  });

  it('abort clears session mode and kills runner session', async () => {
    const adapter = new CursorAgentAdapter(async () => null);
    adapter.setSessionMode('sess', 'ask');
    await adapter.abort('sess', '/p');
    expect(abortCursorSessionMock).toHaveBeenCalledWith('sess');
    // next run should not force ask
    for await (const _ of adapter.run(
      'hi',
      { cwd: '/p', claudiaSessionId: 'sess', mode: 'default', env: LEGACY_ENV },
      vi.fn()
    )) {
      /* drain */
    }
    expect(runCursorMock).toHaveBeenCalledWith('hi', expect.objectContaining({ mode: 'default' }));
  });

  it('abort with provider session id clears claudia-keyed session mode while run is active', async () => {
    let unblockRun: (() => void) | undefined;
    const runBlocked = new Promise<void>(resolve => {
      unblockRun = resolve;
    });
    runCursorMock.mockImplementationOnce(async function* (_input, options) {
      options.onSessionId?.('prov-1');
      yield { type: 'init', sessionId: 'prov-1' };
      await runBlocked;
    });
    const adapter = new CursorAgentAdapter(async () => null);
    adapter.setSessionMode('claudia-sess', 'plan');
    const collected: unknown[] = [];
    const runTask = (async () => {
      for await (const ev of adapter.run(
        'hi',
        {
          cwd: '/p',
          claudiaSessionId: 'claudia-sess',
          mode: 'default',
          env: LEGACY_ENV,
        },
        vi.fn()
      )) {
        collected.push(ev);
      }
    })();
    await vi.waitFor(() => expect(collected.length).toBe(1));
    await adapter.abort('prov-1', '/p');
    unblockRun?.();
    await runTask;
    expect(abortCursorSessionMock).toHaveBeenCalledWith('prov-1');
    runCursorMock.mockClear();
    for await (const _ of adapter.run(
      'hi',
      {
        cwd: '/p',
        claudiaSessionId: 'claudia-sess',
        mode: 'default',
        env: LEGACY_ENV,
      },
      vi.fn()
    )) {
      /* drain */
    }
    expect(runCursorMock).toHaveBeenCalledWith('hi', expect.objectContaining({ mode: 'default' }));
  });

  it('clears providerToClaudiaSessionId after normal run completion', async () => {
    runCursorMock.mockImplementationOnce(async function* (_input, options) {
      options.onSessionId?.('prov-1');
      yield { type: 'init', sessionId: 'prov-1' };
    });
    const adapter = new CursorAgentAdapter(async () => null);
    adapter.setSessionMode('claudia-sess', 'plan');
    for await (const _ of adapter.run(
      'hi',
      {
        cwd: '/p',
        claudiaSessionId: 'claudia-sess',
        mode: 'default',
        env: LEGACY_ENV,
      },
      vi.fn()
    )) {
      /* drain */
    }
    // Stale abort with provider id should not resolve to claudia session after cleanup.
    await adapter.abort('prov-1', '/p');
    runCursorMock.mockClear();
    for await (const _ of adapter.run(
      'hi',
      {
        cwd: '/p',
        claudiaSessionId: 'claudia-sess',
        mode: 'default',
        env: LEGACY_ENV,
      },
      vi.fn()
    )) {
      /* drain */
    }
    expect(runCursorMock).toHaveBeenCalledWith('hi', expect.objectContaining({ mode: 'plan' }));
  });

  it('updates getRunState when onSessionId fires', async () => {
    runCursorMock.mockImplementationOnce(async function* (_input, options) {
      options.onSessionId?.('prov-9');
      yield { type: 'init', sessionId: 'prov-9' };
    });
    const adapter = new CursorAgentAdapter(async () => null);
    const context = { cwd: '/p', claudiaSessionId: 'sess', env: LEGACY_ENV };
    for await (const _ of adapter.run('hi', context, vi.fn())) {
      /* drain */
    }
    expect(adapter.getRunState(context).providerSessionId).toBe('prov-9');
  });

  it('uses ACP by default for a new session', async () => {
    const adapter = new CursorAgentAdapter(async () => null);
    for await (const _ of adapter.run('hi', { cwd: '/p', claudiaSessionId: 'sess' }, vi.fn())) {
      /* drain */
    }
    expect(runCursorAcpMock).toHaveBeenCalledOnce();
    expect(runCursorMock).not.toHaveBeenCalled();
  });

  it('resumes an ACP-bound session with the persisted transport', async () => {
    const adapter = new CursorAgentAdapter(async () => null);
    for await (const _ of adapter.run(
      'continue',
      {
        cwd: '/p',
        sessionId: 'provider-acp',
        providerTransport: 'cursor-acp-v1',
        claudiaSessionId: 'sess',
        env: LEGACY_ENV,
      },
      vi.fn()
    )) {
      /* drain */
    }
    expect(runCursorAcpMock).toHaveBeenCalledWith(
      'continue',
      expect.objectContaining({
        sessionId: 'provider-acp',
        providerTransport: 'cursor-acp-v1',
      })
    );
    expect(runCursorMock).not.toHaveBeenCalled();
  });

  it('fails closed on an unknown new-session transport setting', async () => {
    const adapter = new CursorAgentAdapter(async () => null);
    const drain = async () => {
      for await (const _ of adapter.run(
        'hi',
        {
          cwd: '/p',
          claudiaSessionId: 'sess',
          env: { ZCLAUDIA_CURSOR_TRANSPORT: 'typo' },
        },
        vi.fn()
      )) {
        /* drain */
      }
    };
    await expect(drain()).rejects.toThrow('Unsupported ZCLAUDIA_CURSOR_TRANSPORT value');
    expect(runCursorAcpMock).not.toHaveBeenCalled();
    expect(runCursorMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown persisted transport instead of guessing', async () => {
    const adapter = new CursorAgentAdapter(async () => null);
    const drain = async () => {
      for await (const _ of adapter.run(
        'continue',
        {
          cwd: '/p',
          sessionId: 'provider-unknown',
          providerTransport: 'cursor-unknown-v1',
          claudiaSessionId: 'sess',
        },
        vi.fn()
      )) {
        /* drain */
      }
    };
    await expect(drain()).rejects.toThrow('Unsupported persisted Cursor transport');
    expect(runCursorAcpMock).not.toHaveBeenCalled();
    expect(runCursorMock).not.toHaveBeenCalled();
  });
});
