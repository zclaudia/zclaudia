import { describe, expect, it, vi } from 'vitest';
import type {
  PortableSkillCandidate,
  RuntimeDiscoveryContext,
  RuntimeTurnInput,
  RuntimeTurnContext,
} from '@zclaudia/shared/providers';
import type { RunOptions } from '../types.js';
import { createPiInvocations, preparePortableSkillTurn } from '../invocations.js';

const CONTEXT: RuntimeDiscoveryContext = {
  runtimeType: 'pi',
  engineMode: 'default',
  adapterVersion: '1',
  canonicalCwd: '/repo',
  configurationRoots: ['/repo'],
  settingsSourcePolicy: [],
  configurationRootFingerprint: 'cfg',
};

const REGISTRY = [
  {
    id: 'release-notes',
    name: 'Release Notes',
    description: 'Write release notes',
    source: 'workspace',
    eligible: true,
  },
  { id: 'personal-notes', name: 'Personal Notes', source: 'external', eligible: true },
  { id: 'draft-skill', name: 'Draft', source: 'workspace', eligible: false },
];

describe('Pi invocations provider (URIP §14.4, §24.4)', () => {
  it('declares a static portable catalog with bridged execution', async () => {
    const provider = createPiInvocations({ listSkills: () => REGISTRY });
    const capabilities = await provider.capabilities(CONTEXT);
    expect(capabilities).toMatchObject({
      catalog: 'static',
      executionModes: ['bridged'],
      portableSkills: 'context',
      unknownTextPassthrough: true,
    });
  });

  it('publishes portable.skill entries under the /skill: namespace with eligibility', async () => {
    const provider = createPiInvocations({ listSkills: () => REGISTRY });
    const catalog = await provider.discover(CONTEXT, new AbortController().signal);
    expect(catalog.items).toHaveLength(3);
    const release = catalog.items.find(i => i.descriptor.name === 'release-notes')!;
    expect(release.descriptor).toMatchObject({
      kind: 'portable.skill',
      runtimeType: 'pi',
      displayTrigger: '/skill:release-notes',
      origin: { owner: 'host', scope: 'project' },
      execution: { mode: 'bridged', fidelity: 'exact' },
      availability: { available: true },
    });
    const draft = catalog.items.find(i => i.descriptor.name === 'draft-skill')!;
    expect(draft.descriptor.availability).toMatchObject({ available: false });
  });

  it('assesses skills individually: plain ones bridged/context, resourceful ones unsupported', async () => {
    const provider = createPiInvocations();
    const plain: PortableSkillCandidate = {
      id: 'plain',
      name: 'plain',
      description: '',
      metadata: {},
      resourceManifest: [],
      contentDigest: 'd',
    };
    const withResources: PortableSkillCandidate = {
      ...plain,
      id: 'rich',
      resourceManifest: [{ relativePath: 'data.csv', size: 3, contentDigest: 'x' }],
    };
    expect(
      await provider.assessPortableSkill(plain, CONTEXT, new AbortController().signal)
    ).toMatchObject({
      supported: true,
      mode: 'context',
      executionMode: 'bridged',
      fidelity: 'exact',
      resourceAccess: 'none',
    });
    expect(
      await provider.assessPortableSkill(withResources, CONTEXT, new AbortController().signal)
    ).toMatchObject({
      supported: false,
      mode: 'unsupported',
      code: 'PORTABLE_SKILL_RESOURCE_UNAVAILABLE',
    });
  });

  it('providerLocalKeys stay stable across scans', async () => {
    const provider = createPiInvocations({ listSkills: () => REGISTRY });
    const a = await provider.discover(CONTEXT, new AbortController().signal);
    const b = await provider.discover(CONTEXT, new AbortController().signal);
    expect(a.items.map(i => i.providerLocalKey)).toEqual(b.items.map(i => i.providerLocalKey));
  });
});

// ── typed portable-skill turn (§14.4) ────────────────────────────────────────

describe('preparePortableSkillTurn', () => {
  const input = {
    type: 'portable-skill' as const,
    skill: {
      id: 'release-notes',
      name: 'Release Notes',
      description: '',
      body: 'SKILL BODY TEXT',
      metadata: {},
      contentDigest: 'd',
    },
    assessment: {
      supported: true,
      mode: 'context' as const,
      executionMode: 'bridged' as const,
      fidelity: 'exact' as const,
      resourceAccess: 'none' as const,
    },
    arguments: { type: 'raw' as const, value: 'ZOOM-1 shipped the gate' },
  };

  it('loads the materialized body into the skill state channel keyed source:id', () => {
    const { state, text } = preparePortableSkillTurn(input, undefined);
    expect(state.loadedSkillContents['external:release-notes']).toBe('SKILL BODY TEXT');
    expect(state.loadedSkills.some(s => s.id === 'release-notes')).toBe(true);
    expect(text).toBe('ZOOM-1 shipped the gate');
  });

  it('falls back to the canonical inline hint when no args are given', () => {
    const noArgs: typeof input = {
      ...input,
      arguments: { type: 'raw', value: '  ' },
    };
    const { text } = preparePortableSkillTurn(noArgs, undefined);
    expect(text).toBe('Use the Release Notes skill.');
  });

  it('reuses an existing skill state instead of dropping loaded skills', () => {
    const existing = {
      discoverableSkills: [],
      pinnedSkills: [],
      loadedSkills: [{ source: 'workspace' as const, id: 'other' }],
      loadedSkillContents: {},
    };
    const { state } = preparePortableSkillTurn(input, existing);
    expect(state).toBe(existing);
    expect(state.loadedSkills.some(s => s.id === 'other')).toBe(true);
  });
});

// ── PiAgentProviderAdapter.startTurn delegation ──────────────────────────────

describe('PiAgentProviderAdapter.startTurn', () => {
  it('delegates messages and portable-skill turns to the string run with loaded state', async () => {
    const { PiAgentProviderAdapter } = await import('../../pi-agent/adapter.js');
    const adapter = new PiAgentProviderAdapter();
    const seen: Array<{ text: string; skillState: unknown }> = [];
    const runSpy = vi.spyOn(PiAgentProviderAdapter.prototype, 'run').mockImplementation(function* (
      input: string,
      options: RunOptions
    ) {
      seen.push({ text: input, skillState: options.skillState });
      yield { type: 'provider_turn_finished', isComplete: true } as never;
    });
    try {
      const turnContext = {} as RuntimeTurnContext;
      for await (const _ of adapter.startTurn!(
        { type: 'message', text: 'plain' } satisfies RuntimeTurnInput,
        turnContext as unknown as RunOptions,
        async () => ({ behavior: 'deny' })
      )) {
        /* drain */
      }
      expect(seen[0]?.text).toBe('plain');

      for await (const _ of adapter.startTurn!(
        {
          type: 'portable-skill',
          skill: {
            id: 'release-notes',
            name: 'Release Notes',
            description: '',
            body: 'BODY',
            metadata: {},
            contentDigest: 'd',
          },
          assessment: {
            supported: true,
            mode: 'context' as const,
            executionMode: 'bridged' as const,
            fidelity: 'exact' as const,
            resourceAccess: 'none' as const,
          },
          arguments: { type: 'raw', value: 'with args' },
        },
        turnContext as unknown as RunOptions,
        async () => ({ behavior: 'deny' })
      )) {
        /* drain */
      }
      expect(seen[1]?.text).toBe('with args');
      const state = seen[1]?.skillState as { loadedSkillContents: Record<string, string> };
      expect(state.loadedSkillContents['external:release-notes']).toBe('BODY');
    } finally {
      runSpy.mockRestore();
    }
  });

  it('rejects runtime invocations — Pi publishes no native command catalog', async () => {
    const { PiAgentProviderAdapter } = await import('../../pi-agent/adapter.js');
    const adapter = new PiAgentProviderAdapter();
    await expect(
      (async () => {
        for await (const _ of adapter.startTurn!(
          {
            type: 'runtime-invocation',
            descriptor: {
              id: 'x',
              kind: 'runtime.command',
              runtimeType: 'pi',
              name: 'x',
              label: 'x',
              displayTrigger: '/x',
              origin: { owner: 'runtime' as never, scope: 'system' },
              execution: {
                mode: 'native-text' as never,
                fidelity: 'exact' as never,
                arguments: {
                  accepted: ['raw' as const],
                  preferred: 'raw' as const,
                  transcript: { raw: 'verbatim' as const },
                },
              },
              availability: { available: true },
            },
            nativeLocator: {},
            arguments: { type: 'raw', value: '' },
          },
          {} as RunOptions,
          async () => ({ behavior: 'deny' })
        )) {
          /* drain */
        }
      })()
    ).rejects.toMatchObject({ code: 'INVOCATION_UNSUPPORTED' });
  });
});
