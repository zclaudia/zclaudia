import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RuntimeDiscoveryContext,
  RuntimeInvocableRecord,
  RuntimeTurnInput,
  RuntimeTurnContext,
} from '@zclaudia/plugin-sdk/invocations';
import type { SkillsListEntry } from '../app-server-protocol.js';
import { createCodexInvocations } from '../invocations.js';

// ── Fixture: the shape pinned Codex 0.154.0 returns for skills/list ──────────

const FIXTURE_SKILLS: SkillsListEntry[] = [
  {
    name: 'my-stocks',
    description: 'A-share research workflows',
    path: '/Users/example/.codex/skills/my-stocks/SKILL.md',
    scope: 'user',
    enabled: true,
  },
  {
    name: 'documents:documents',
    description: 'Create and edit documents',
    path: '/Users/example/.codex/plugins/cache/documents/SKILL.md',
    scope: 'user',
    enabled: true,
    interface: { displayName: 'Documents' },
  },
  {
    name: 'disabled-skill',
    description: 'Turned off',
    path: '/Users/example/.codex/skills/disabled/SKILL.md',
    scope: 'project',
    enabled: false,
  },
];

function makeContext(overrides: Partial<RuntimeDiscoveryContext> = {}): RuntimeDiscoveryContext {
  return {
    runtimeType: 'codex',
    engineMode: 'cli',
    adapterVersion: '1',
    canonicalCwd: '/repo',
    configurationRoots: ['/repo'],
    settingsSourcePolicy: ['user', 'project'],
    configurationRootFingerprint: 'cfg',
    ...overrides,
  };
}

function makeProvider(overrides: { skills?: SkillsListEntry[] } = {}) {
  const listSkills = vi.fn(async () => overrides.skills ?? FIXTURE_SKILLS);
  const getClient = vi.fn(async () => ({ listSkills }));
  const readFile = vi.fn(async (path: string) => `content:${path}`);
  const provider = createCodexInvocations({ getClient, readFile });
  return { provider, listSkills, getClient };
}

beforeEach(() => {
  vi.resetModules();
});

describe('Codex invocations provider (URIP §24.4 conformance)', () => {
  it('declares a truthful runtime catalog with native-structured skill execution', async () => {
    const { provider } = makeProvider();
    const capabilities = await provider.capabilities(makeContext());
    expect(capabilities).toMatchObject({
      catalog: 'runtime',
      executionModes: ['native-structured'],
      catalogLifecycle: 'bootstrap-only',
      unknownTextPassthrough: true,
      portableSkills: 'unsupported',
    });
    // assessPortableSkill is optional exactly when portableSkills is unsupported.
    expect(provider.assessPortableSkill).toBeUndefined();
  });

  it('maps skills/list into runtime.skill records with exact fidelity (§24.4 item 12)', async () => {
    const { provider } = makeProvider();
    const catalog = await provider.discover(makeContext(), new AbortController().signal);
    expect(catalog.phase).toBe('live');
    expect(catalog.completeness).toBe('complete');
    expect(catalog.items).toHaveLength(3);
    const enabled = catalog.items[0];
    expect(enabled.descriptor).toMatchObject({
      kind: 'runtime.skill',
      runtimeType: 'codex',
      name: 'my-stocks',
      displayTrigger: '/my-stocks',
      execution: { mode: 'native-structured', fidelity: 'exact' },
      availability: { available: true },
    });
    // Disabled skills stay listed but unavailable (§11 diagnostics, not silent drops).
    expect(catalog.items[2].descriptor.availability).toMatchObject({ available: false });
  });

  it('discover() respects abort (§24.4 item 1)', async () => {
    const { provider, getClient } = makeProvider();
    const controller = new AbortController();
    controller.abort();
    await expect(provider.discover(makeContext(), controller.signal)).rejects.toThrow(/aborted/);
    expect(getClient).not.toHaveBeenCalled();
  });

  it('discovery touches only the minimal context allowlist (§24.4 item 2)', async () => {
    const accessed = new Set<string>();
    const context = new Proxy(makeContext(), {
      get(target, prop) {
        accessed.add(String(prop));
        return target[prop as keyof RuntimeDiscoveryContext];
      },
    }) as RuntimeDiscoveryContext;
    const { provider } = makeProvider();
    await provider.discover(context, new AbortController().signal);
    for (const key of accessed) {
      expect(
        [
          'runtimeType',
          'engineMode',
          'adapterVersion',
          'canonicalCwd',
          'configurationRoots',
          'settingsSourcePolicy',
          'configurationRootFingerprint',
        ],
        `context.${key} must not be read by discovery`
      ).toContain(key);
    }
    expect(accessed.has('session')).toBe(false);
  });

  it('descriptors carry no locator or absolute path; locators stay adapter-private (§24.4 item 3)', async () => {
    const { provider } = makeProvider();
    const catalog = await provider.discover(makeContext(), new AbortController().signal);
    for (const record of catalog.items) {
      // The public descriptor half must be free of locator/path data; only the
      // private record half carries what the adapter needs at execution time.
      const descriptorJson = JSON.stringify(record.descriptor);
      expect(descriptorJson).not.toContain('SKILL.md');
      expect(descriptorJson).not.toContain('/Users/example');
      expect(record.nativeLocator).toBeDefined();
    }
    const record = catalog.items[0];
    expect(record.nativeLocator).toEqual({
      type: 'skill',
      name: 'my-stocks',
      path: '/Users/example/.codex/skills/my-stocks/SKILL.md',
    });
  });

  it('IDs remain stable across unchanged scans (§24.4 item 4)', async () => {
    const { provider } = makeProvider();
    const first = await provider.discover(makeContext(), new AbortController().signal);
    const second = await provider.discover(makeContext(), new AbortController().signal);
    expect(first.items.map(i => i.providerLocalKey)).toEqual(
      second.items.map(i => i.providerLocalKey)
    );
  });

  it('malformed entries degrade to diagnostics instead of crashing discovery', async () => {
    const { provider } = makeProvider({
      skills: [{ name: '', path: '' }, { ...FIXTURE_SKILLS[0] }],
    });
    const catalog = await provider.discover(makeContext(), new AbortController().signal);
    expect(catalog.items).toHaveLength(1);
    expect(catalog.diagnostics.length).toBeGreaterThan(0);
  });
});

// ── startTurn conformance (adapter V2 contract, §9) ──────────────────────────

async function makeAdapterWithSpiedRunner() {
  const runSpy = vi.fn(async function* (input: string) {
    yield { type: 'init', sessionId: 'thread-1' } as never;
    yield { type: 'provider_turn_finished', isComplete: true } as never;
    void input;
  });
  vi.doMock('../runner.js', () => ({
    runCodexAppServer: runSpy,
    runCodexSdkTurn: vi.fn(),
    abortCodexSession: vi.fn(),
    getOrCreateAppServerClient: vi.fn(),
  }));
  const { CodexAgentAdapter } = await import('../adapter.js');
  const adapter = new CodexAgentAdapter(async () => null);
  return { adapter, runSpy };
}

function turnContext(): RuntimeTurnContext {
  return {
    cwd: '/repo',
    env: {},
    services: {
      portableSkillResources: {
        read: async () => {
          throw new Error('not used');
        },
      },
    },
  } as unknown as RuntimeTurnContext;
}

function skillInvocation(): RuntimeTurnInput {
  return {
    type: 'runtime-invocation',
    descriptor: {
      id: 'inv1:skill',
      kind: 'runtime.skill',
      runtimeType: 'codex',
      name: 'my-stocks',
      label: 'my-stocks',
      displayTrigger: '/my-stocks',
      origin: { owner: 'runtime', scope: 'user' },
      execution: {
        mode: 'native-structured',
        fidelity: 'exact',
        arguments: { accepted: ['raw'], preferred: 'raw', transcript: { raw: 'verbatim' } },
      },
      availability: { available: true },
    },
    nativeLocator: {
      type: 'skill',
      name: 'my-stocks',
      path: '/Users/example/.codex/skills/my-stocks/SKILL.md',
    },
    arguments: { type: 'raw', value: 'screen 600519 with my usual pool' },
  };
}

describe('CodexAgentAdapter.startTurn (§9, §14.2)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('passes plain message text through byte-for-byte (§24.4 item 5)', async () => {
    const { adapter, runSpy } = await makeAdapterWithSpiedRunner();
    const input: RuntimeTurnInput = { type: 'message', text: 'plain /text stays exact' };
    for await (const _ of adapter.startTurn(input, turnContext(), async () => ({
      behavior: 'deny',
    }))) {
      /* drain */
    }
    expect(runSpy.mock.calls[0][0]).toBe('plain /text stays exact');
  });

  it('builds a structured skill turn from the native locator, args verbatim (§14.2)', async () => {
    const { adapter, runSpy } = await makeAdapterWithSpiedRunner();
    const events = [];
    for await (const event of adapter.startTurn(skillInvocation(), turnContext(), async () => ({
      behavior: 'deny',
    }))) {
      events.push(event);
    }
    const options = runSpy.mock.calls[0][1];
    expect(options.inputBlocks).toEqual([
      { type: 'skill', name: 'my-stocks', path: '/Users/example/.codex/skills/my-stocks/SKILL.md' },
      { type: 'text', text: 'screen 600519 with my usual pool', text_elements: [] },
    ]);
    // Terminal exactly once (§24.4 item 10).
    expect(
      events.filter(e => (e as { type: string }).type === 'provider_turn_finished')
    ).toHaveLength(1);
  });

  it('omits the text block when the invocation carries no arguments', async () => {
    const { adapter, runSpy } = await makeAdapterWithSpiedRunner();
    const invocation = skillInvocation();
    (invocation.arguments as { value: string }).value = '';
    for await (const _ of adapter.startTurn(invocation, turnContext(), async () => ({
      behavior: 'deny',
    }))) {
      /* drain */
    }
    expect((runSpy.mock.calls[0][1] as { inputBlocks: unknown[] }).inputBlocks).toEqual([
      { type: 'skill', name: 'my-stocks', path: '/Users/example/.codex/skills/my-stocks/SKILL.md' },
    ]);
  });

  it('fails portable skills explicitly before any provider turn (§24.4 item 9)', async () => {
    const { adapter, runSpy } = await makeAdapterWithSpiedRunner();
    await expect(
      (async () => {
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
              mode: 'context',
              executionMode: 'bridged',
              fidelity: 'best-effort',
              resourceAccess: 'none',
            },
            arguments: { type: 'raw', value: '' },
          },
          turnContext(),
          async () => ({ behavior: 'deny' })
        )) {
          // drain
        }
      })()
    ).rejects.toMatchObject({ code: 'PORTABLE_SKILL_UNSUPPORTED' });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('rejects stale/malformed locators instead of guessing a reference', async () => {
    const { adapter } = await makeAdapterWithSpiedRunner();
    const invocation = skillInvocation();
    (invocation as { nativeLocator: unknown }).nativeLocator = { type: 'skill' };
    await expect(
      (async () => {
        for await (const _ of adapter.startTurn(invocation, turnContext(), async () => ({
          behavior: 'deny',
        }))) {
          // drain
        }
      })()
    ).rejects.toMatchObject({ code: 'INVOCATION_PROTOCOL_MISMATCH' });
  });
});
