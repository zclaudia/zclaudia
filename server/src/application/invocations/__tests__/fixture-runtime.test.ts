import { describe, expect, it } from 'vitest';
import type {
  InvocableCatalogSnapshot,
  RuntimeDiscoveryContext,
  RuntimeInvocableCatalog,
  RuntimeTurnInput,
} from '@zclaudia/shared/providers';
import { resolveInvocation } from '../router.js';
import { contextFingerprint } from '../catalog-service.js';

/**
 * Generic fixture runtime conformance (URIP design doc §24.4).
 *
 * Proves the host contract with a structured catalog + invocation runtime —
 * the same tests every bundled runtime adapter must pass before shipping.
 */

interface FixtureState {
  receivedTurns: RuntimeTurnInput[];
  aborted: false | Error;
}

function makeFixtureRuntime() {
  const state: FixtureState = { receivedTurns: [], aborted: false };
  const adapter = {
    capabilities: async (context: RuntimeDiscoveryContext) => ({
      catalog: 'runtime' as const,
      executionModes: ['native-structured' as const],
      refresh: 'manual' as const,
      discoveryScope: 'shared-context' as const,
      catalogLifecycle: 'bootstrap-then-live' as const,
      unknownTextPassthrough: true,
      portableSkills: 'unsupported' as const,
    }),
    discover: async (
      context: RuntimeDiscoveryContext,
      signal: AbortSignal
    ): Promise<RuntimeInvocableCatalog> => {
      if (signal.aborted) {
        state.aborted = new Error('discovery aborted');
        throw state.aborted;
      }
      return {
        items: [
          {
            descriptor: {
              kind: 'runtime.command',
              runtimeType: context.runtimeType,
              name: 'deploy',
              label: 'Deploy',
              displayTrigger: '/deploy',
              origin: { owner: 'plugin', scope: 'project' },
              execution: {
                mode: 'native-structured',
                fidelity: 'exact',
                arguments: {
                  accepted: ['structured'],
                  preferred: 'structured',
                  schema: {
                    type: 'object',
                    properties: {
                      target: { type: 'string' },
                      token: { type: 'string', writeOnly: true },
                    },
                    required: ['target'],
                  },
                  transcript: { structured: 'schema-redacted' },
                },
              },
              availability: { available: true },
            },
            providerLocalKey: 'deploy',
            // Native locator carries a credential-shaped value that must never
            // leak into public descriptors or transcripts.
            nativeLocator: { endpoint: 'internal://deploy', secret: 'loc-secret' },
          },
        ],
        diagnostics: [],
        phase: 'live',
        completeness: 'complete',
        runtimeSessionEpoch: 'epoch-2',
      };
    },
    startTurn: async function* (input: RuntimeTurnInput) {
      state.receivedTurns.push(input);
      yield { type: 'init', sessionId: 'fixture-1', providerTransport: 'fixture-v1' };
      yield { type: 'provider_turn_finished', isComplete: true };
    },
  };
  return { adapter, state };
}

function snapshotFor(fixtureItems: unknown, fingerprint: string): InvocableCatalogSnapshot {
  return {
    protocolVersion: 1,
    revision: 'rev-fixture',
    generatedAt: Date.now(),
    contextFingerprint: fingerprint,
    phase: 'live',
    completeness: 'complete',
    invocables: fixtureItems as InvocableCatalogSnapshot['invocables'],
    diagnostics: [],
  };
}

const BINDING = {
  backendIdentity: 'local',
  sessionId: 'session-1',
  runtimeType: 'fixture',
  engineMode: 'default',
  canonicalCwd: '/repo',
  configurationRootFingerprint: 'cfg',
  settingsSourcePolicy: ['user'],
  catalogPhase: 'live' as const,
  runtimeSessionEpoch: 'epoch-2',
};
const FINGERPRINT = contextFingerprint(BINDING);

describe('fixture runtime conformance', () => {
  it('exposes no native locator data in public descriptors', async () => {
    const { adapter } = makeFixtureRuntime();
    const catalog = await adapter.discover(
      {
        runtimeType: 'fixture',
        engineMode: 'default',
        adapterVersion: '1',
        canonicalCwd: '/repo',
        configurationRoots: ['/repo'],
        settingsSourcePolicy: ['user'],
        configurationRootFingerprint: 'cfg',
      },
      new AbortController().signal
    );
    for (const item of catalog.items) {
      const serialized = JSON.stringify(item.descriptor);
      expect(serialized).not.toContain('loc-secret');
      expect(serialized).not.toContain('internal://deploy');
    }
  });

  it('routes the native locator back to the adapter only, with typed arguments', async () => {
    const { adapter, state } = makeFixtureRuntime();
    const catalog = await adapter.discover(
      {
        runtimeType: 'fixture',
        engineMode: 'default',
        adapterVersion: '1',
        canonicalCwd: '/repo',
        configurationRoots: ['/repo'],
        settingsSourcePolicy: ['user'],
        configurationRootFingerprint: 'cfg',
      },
      new AbortController().signal
    );
    const record = catalog.items[0];
    const descriptor = { ...record.descriptor, id: 'inv1:fixture' };
    const resolution = await resolveInvocation(
      {
        invocableId: 'inv1:fixture',
        catalogRevision: 'rev-fixture',
        contextFingerprint: FINGERPRINT,
        arguments: { type: 'structured', value: { target: 'staging', token: 'user-secret' } },
      },
      {
        currentBinding: { ...BINDING },
        currentSnapshot: snapshotFor([descriptor], FINGERPRINT),
        snapshotByRevision: () => snapshotFor([descriptor], FINGERPRINT),
        recordFor: () => ({ descriptor, nativeLocator: record.nativeLocator }),
      }
    );

    // startTurn receives the locator; the transcript shows the redacted form.
    expect(resolution.turnInput?.type).toBe('runtime-invocation');
    if (resolution.turnInput?.type === 'runtime-invocation') {
      const stream = adapter.startTurn(resolution.turnInput);
      for await (const _ of stream) {
        /* drain */
      }
    }
    expect(state.receivedTurns).toHaveLength(1);
    expect(JSON.stringify(state.receivedTurns[0])).toContain('internal://deploy');
    expect(resolution.transcriptText).not.toContain('user-secret');
    expect(resolution.transcriptText).not.toContain('loc-secret');
    expect(resolution.transcriptText).toBe('/deploy --target="staging"');
  });

  it('keeps exactly one terminal event per typed turn', async () => {
    const { adapter } = makeFixtureRuntime();
    const stream = adapter.startTurn({
      type: 'message',
      text: 'plain text stays plain',
    });
    const events = [];
    for await (const event of stream) events.push(event);
    expect(events.filter(e => e.type === 'provider_turn_finished')).toHaveLength(1);
  });
});
