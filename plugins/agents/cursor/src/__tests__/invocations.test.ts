import { describe, expect, it, vi } from 'vitest';
import type {
  RuntimeDiscoveryContext,
  RuntimeTurnInput,
  RuntimeTurnContext,
} from '@zclaudia/plugin-sdk/invocations';
import { createCursorInvocations } from '../invocations.js';

const CONTEXT: RuntimeDiscoveryContext = {
  runtimeType: 'cursor',
  engineMode: 'default',
  adapterVersion: '1',
  canonicalCwd: '/repo',
  configurationRoots: ['/repo'],
  settingsSourcePolicy: [],
  configurationRootFingerprint: 'cfg',
};

const ADVERTISED = [
  { name: 'copy-request-id', description: 'Copy the last request id' },
  { name: 'multi-model-review', description: 'Review with multiple models' },
];

function makeProvider() {
  const newSession = vi.fn(async (_cwd: string) => {});
  const close = vi.fn(async () => {});
  let updateSink:
    | ((update: {
        sessionUpdate: string;
        availableCommands?: Array<{ name: string; description?: string }>;
      }) => void)
    | undefined;
  const newClient = vi.fn(async (cwd: string, _signal: AbortSignal) => {
    const client = {
      onUpdate: (cb: typeof updateSink) => {
        updateSink = cb;
      },
      newSession: newSession,
      close,
      /** Test seam: the fake agent advertises its commands after session/new. */
      advertise: () =>
        updateSink?.({ sessionUpdate: 'available_commands_update', availableCommands: ADVERTISED }),
    };
    const innerNewSession = client.newSession;
    client.newSession = async (sessionCwd: string) => {
      await innerNewSession(sessionCwd);
      client.advertise();
    };
    return client;
  });
  const provider = createCursorInvocations({
    newClient,
    delay: async () => {},
  });
  return { provider, newSession, close };
}

function makeAdapterDeps() {
  const runSpy = vi.fn(async function* (input: string) {
    yield { type: 'provider_turn_finished', isComplete: true } as never;
    void input;
  });
  vi.doMock('../acp-runner.js', () => ({
    runCursorAcp: runSpy,
    CURSOR_ACP_TRANSPORT: 'cursor-acp-v1',
  }));
  vi.doMock('../runner.js', () => ({
    runCursor: runSpy,
    abortCursorSession: vi.fn(),
    destroyAllCursorProcesses: vi.fn(),
  }));
  vi.resetModules();
  return { runSpy };
}

async function makeAdapter() {
  const { runSpy } = makeAdapterDeps();
  const { CursorAgentAdapter } = await import('../adapter.js');
  const adapter = new CursorAgentAdapter(async () => null);
  return { adapter, runSpy };
}

function turnContext(): RuntimeTurnContext {
  return {
    cwd: '/repo',
    services: {
      portableSkillResources: {
        read: async () => {
          throw new Error('unused');
        },
      },
    },
  } as unknown as RuntimeTurnContext;
}

describe('Cursor invocations provider (URIP §14.3, §24.4)', () => {
  it('publishes ACP-advertised commands as emulated/best-effort — never native', async () => {
    const { provider } = makeProvider();
    const capabilities = await provider.capabilities(CONTEXT);
    expect(capabilities).toMatchObject({
      catalog: 'runtime',
      executionModes: ['emulated'],
      portableSkills: 'emulated',
    });
    const catalog = await provider.discover(CONTEXT, new AbortController().signal);
    expect(catalog.items.map(i => i.descriptor.displayTrigger)).toEqual([
      '/copy-request-id',
      '/multi-model-review',
    ]);
    for (const item of catalog.items) {
      // §14.3: headless expansion is unprobed, so the transport is emulated.
      expect(item.descriptor.execution).toMatchObject({
        mode: 'emulated',
        fidelity: 'best-effort',
      });
      expect(item.descriptor.kind).toBe('runtime.command');
    }
  });

  it('closes the discovery session even when collection succeeds', async () => {
    const { provider, close, newSession } = makeProvider();
    await provider.discover(CONTEXT, new AbortController().signal);
    expect(newSession).toHaveBeenCalledWith('/repo');
    expect(close).toHaveBeenCalled();
  });

  it('respects abort during the collection window', async () => {
    const { provider } = makeProvider();
    const controller = new AbortController();
    controller.abort();
    await expect(provider.discover(CONTEXT, controller.signal)).rejects.toThrow(/aborted/);
  });

  it('locator stays adapter-private while descriptors carry only trigger text', async () => {
    const { provider } = makeProvider();
    const catalog = await provider.discover(CONTEXT, new AbortController().signal);
    const record = catalog.items[0];
    expect(JSON.stringify(record.descriptor)).not.toContain('acp-command');
    expect(record.nativeLocator).toEqual({ type: 'acp-command', name: 'copy-request-id' });
  });
});

describe('CursorAgentAdapter.startTurn (§9, §14.3)', () => {
  it('compiles a selected command into the ACP prompt with args verbatim', async () => {
    const { adapter, runSpy } = await makeAdapter();
    const input: RuntimeTurnInput = {
      type: 'runtime-invocation',
      descriptor: {
        id: 'inv1:cmd',
        kind: 'runtime.command',
        runtimeType: 'cursor',
        name: 'multi-model-review',
        label: 'multi-model-review',
        displayTrigger: '/multi-model-review',
        origin: { owner: 'runtime', scope: 'system' },
        execution: {
          mode: 'emulated',
          fidelity: 'best-effort',
          arguments: { accepted: ['raw'], preferred: 'raw', transcript: { raw: 'verbatim' } },
        },
        availability: { available: true },
      },
      nativeLocator: { type: 'acp-command', name: 'multi-model-review' },
      arguments: { type: 'raw', value: 'focus on the ACP runner' },
    };
    for await (const _ of adapter.startTurn(input, turnContext(), async () => ({
      behavior: 'deny',
    }))) {
      /* drain */
    }
    expect(runSpy.mock.calls[0][0]).toBe('/multi-model-review focus on the ACP runner');
  });

  it('passes message text through byte-for-byte', async () => {
    const { adapter, runSpy } = await makeAdapter();
    for await (const _ of adapter.startTurn(
      { type: 'message', text: 'plain' },
      turnContext(),
      async () => ({ behavior: 'deny' })
    )) {
      /* drain */
    }
    expect(runSpy.mock.calls[0][0]).toBe('plain');
  });

  it('compiles portable skills into the prompt and rejects resourceful ones', async () => {
    const { adapter, runSpy } = await makeAdapter();
    for await (const _ of adapter.startTurn(
      {
        type: 'portable-skill',
        skill: {
          id: 's',
          name: 's',
          description: '',
          body: 'BODY',
          metadata: {},
          contentDigest: 'd',
        },
        assessment: {
          supported: true,
          mode: 'emulated',
          executionMode: 'emulated',
          fidelity: 'best-effort',
          resourceAccess: 'none',
        },
        arguments: { type: 'raw', value: '' },
      },
      turnContext(),
      async () => ({ behavior: 'deny' })
    )) {
      /* drain */
    }
    expect(runSpy.mock.calls[0][0]).toBe('BODY');

    await expect(
      (async () => {
        for await (const _ of adapter.startTurn(
          {
            type: 'portable-skill',
            skill: {
              id: 'r',
              name: 'r',
              description: '',
              body: 'B',
              metadata: {},
              resources: { type: 'host-read-handle', handleId: 'h', entries: [] },
              contentDigest: 'd',
            },
            assessment: {
              supported: true,
              mode: 'emulated',
              executionMode: 'emulated',
              fidelity: 'best-effort',
              resourceAccess: 'none',
            },
            arguments: { type: 'raw', value: '' },
          },
          turnContext(),
          async () => ({ behavior: 'deny' })
        )) {
          /* drain */
        }
      })()
    ).rejects.toMatchObject({ code: 'PORTABLE_SKILL_RESOURCE_UNAVAILABLE' });
  });
});
