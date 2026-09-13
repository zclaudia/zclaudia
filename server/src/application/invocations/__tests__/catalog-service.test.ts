import { describe, expect, it } from 'vitest';
import type { RuntimeInvocableRecord } from '@zclaudia/shared/providers';
import {
  InvocableCatalogService,
  contextFingerprint,
  sameContextIdentity,
  stableInvocableId,
  type CatalogSnapshotRequest,
} from '../catalog-service.js';

function makeRequest(overrides: Partial<CatalogSnapshotRequest> = {}): CatalogSnapshotRequest {
  return {
    backendIdentity: 'local',
    sessionId: 'session-1',
    runtimeType: 'claude',
    engineMode: 'cli',
    canonicalCwd: '/repo',
    configurationRootFingerprint: 'cfg-1',
    settingsSourcePolicy: ['user', 'project'],
    adapterVersion: '1.0.0',
    hostDescriptors: [
      {
        kind: 'host.action',
        runtimeType: 'host',
        name: 'help',
        label: 'Help',
        displayTrigger: '/zc:help',
        origin: { owner: 'host', scope: 'system' },
        execution: {
          mode: 'host',
          fidelity: 'exact',
          arguments: { accepted: ['raw'], preferred: 'raw', transcript: { raw: 'verbatim' } },
        },
        availability: { available: true },
      },
    ],
    portableEntries: [],
    runtimeSource: {
      discover: async () => ({
        items: [
          {
            descriptor: {
              kind: 'runtime.command',
              runtimeType: 'claude',
              name: 'review',
              label: 'Review',
              displayTrigger: '/review',
              origin: { owner: 'project', scope: 'project' },
              execution: {
                mode: 'native-text',
                fidelity: 'exact',
                arguments: { accepted: ['raw'], preferred: 'raw', transcript: { raw: 'verbatim' } },
              },
              availability: { available: true },
            },
            providerLocalKey: 'project:review',
            nativeLocator: { file: 'review.md' },
          } satisfies RuntimeInvocableRecord,
        ],
        diagnostics: [],
        phase: 'live',
        completeness: 'complete',
      }),
    },
    ...overrides,
  };
}

const BASE_BINDING = {
  backendIdentity: 'local',
  sessionId: 'session-1',
  runtimeType: 'claude',
  engineMode: 'cli',
  canonicalCwd: '/repo',
  configurationRootFingerprint: 'cfg-1',
  settingsSourcePolicy: ['user', 'project'],
  catalogPhase: 'live' as const,
};

describe('InvocableCatalogService', () => {
  it('composes host, runtime, and portable catalogs without deduplicating triggers', async () => {
    const service = new InvocableCatalogService();
    const snapshot = await service.getSnapshot(
      makeRequest({
        portableEntries: [
          {
            descriptor: {
              kind: 'portable.skill',
              runtimeType: 'claude',
              name: 'review',
              label: 'Portable Review',
              displayTrigger: '/skill:review',
              origin: { owner: 'project', scope: 'project' },
              execution: {
                mode: 'bridged',
                fidelity: 'best-effort',
                arguments: { accepted: ['raw'], preferred: 'raw', transcript: { raw: 'verbatim' } },
              },
              availability: { available: true },
            },
            providerLocalKey: 'review',
            contentDigest: 'digest-1',
          },
        ],
      })
    );

    const triggers = snapshot.invocables.map(i => i.displayTrigger);
    expect(triggers).toContain('/zc:help');
    expect(triggers).toContain('/review');
    expect(triggers).toContain('/skill:review');
    // A runtime command and a portable skill with the same base name coexist.
    expect(snapshot.invocables.filter(i => i.name === 'review')).toHaveLength(2);
    expect(snapshot.phase).toBe('live');
    expect(snapshot.completeness).toBe('complete');
  });

  it('assigns stable canonical IDs that are opaque and do not leak paths', async () => {
    const service = new InvocableCatalogService();
    const first = await service.getSnapshot(makeRequest());
    const second = await service.getSnapshot(makeRequest());
    for (const descriptor of first.invocables) {
      expect(descriptor.id).toMatch(/^inv1:/);
      expect(descriptor.id).not.toContain('/repo');
    }
    expect(first.invocables.map(i => i.id)).toEqual(second.invocables.map(i => i.id));
  });

  it('shares adapter discovery across sessions in the same context', async () => {
    let discoveryCount = 0;
    const service = new InvocableCatalogService();
    const source = {
      discover: async () => {
        discoveryCount += 1;
        return {
          items: [],
          diagnostics: [],
          phase: 'live' as const,
          completeness: 'complete' as const,
        };
      },
    };
    await service.getSnapshot(makeRequest({ runtimeSource: source }));
    await service.getSnapshot(makeRequest({ runtimeSource: source, sessionId: 'session-2' }));
    expect(discoveryCount).toBe(1);
  });

  it('keeps discovery failure non-fatal: host and portable entries survive with a diagnostic', async () => {
    const service = new InvocableCatalogService();
    const snapshot = await service.getSnapshot(
      makeRequest({
        runtimeSource: {
          discover: async () => {
            throw new Error('runtime offline');
          },
        },
      })
    );
    expect(snapshot.invocables.some(i => i.displayTrigger === '/zc:help')).toBe(true);
    expect(snapshot.phase).toBe('degraded');
    expect(snapshot.completeness).toBe('partial');
    expect(snapshot.diagnostics.some(d => d.code === 'INVOCATION_DISCOVERY_FAILED')).toBe(true);
  });

  it('changes the revision when the runtime catalog content changes', async () => {
    const service = new InvocableCatalogService();
    const first = await service.getSnapshot(makeRequest());
    // The discovery cache must not mask a genuinely different catalog.
    service.invalidateAll();
    const second = await service.getSnapshot(
      makeRequest({
        runtimeSource: {
          discover: async () => ({
            items: [],
            diagnostics: [],
            phase: 'live',
            completeness: 'complete',
          }),
        },
      })
    );
    expect(first.revision).not.toBe(second.revision);
  });

  it('invalidates a session snapshot on session reset', async () => {
    const service = new InvocableCatalogService();
    await service.getSnapshot(makeRequest());
    service.invalidateSession('session-1');
    // Internally the entry is gone; a fresh fetch still succeeds.
    const snapshot = await service.getSnapshot(makeRequest());
    expect(snapshot.invocables).toHaveLength(2);
  });

  it('scopes private native locators by session, revision, and fingerprint', async () => {
    const service = new InvocableCatalogService();
    const first = await service.getSnapshot(makeRequest());
    const second = await service.getSnapshot(makeRequest({ sessionId: 'session-2' }));
    const runtimeId = first.invocables.find(item => item.kind === 'runtime.command')!.id;

    expect(
      service.recordFor('session-1', first.revision, runtimeId, first.contextFingerprint)
        ?.nativeLocator
    ).toEqual({ file: 'review.md' });
    expect(
      service.recordFor('session-2', first.revision, runtimeId, first.contextFingerprint)
    ).toBeUndefined();
    expect(
      service.recordFor('session-2', second.revision, runtimeId, second.contextFingerprint)
        ?.nativeLocator
    ).toEqual({ file: 'review.md' });
  });

  it('changes the composed revision when private content changes', async () => {
    const service = new InvocableCatalogService();
    const portable = (contentDigest: string) => ({
      descriptor: {
        kind: 'portable.skill' as const,
        runtimeType: 'claude',
        name: 'review',
        label: 'Review skill',
        displayTrigger: '/skill:review',
        origin: { owner: 'project' as const, scope: 'project' as const },
        execution: {
          mode: 'emulated' as const,
          fidelity: 'best-effort' as const,
          arguments: {
            accepted: ['raw' as const],
            preferred: 'raw' as const,
            transcript: { raw: 'verbatim' as const },
          },
        },
        availability: { available: true as const },
      },
      providerLocalKey: 'workspace:review',
      contentDigest,
    });
    const first = await service.getSnapshot(makeRequest({ portableEntries: [portable('d1')] }));
    service.invalidateSession('session-1');
    const second = await service.getSnapshot(makeRequest({ portableEntries: [portable('d2')] }));
    expect(second.revision).not.toBe(first.revision);
  });
});

describe('context fingerprints', () => {
  it('changes when cwd, phase, epoch, token, engine mode, or backend change', () => {
    const base = contextFingerprint(BASE_BINDING);
    expect(contextFingerprint({ ...BASE_BINDING, canonicalCwd: '/other' })).not.toBe(base);
    expect(contextFingerprint({ ...BASE_BINDING, catalogPhase: 'bootstrap' })).not.toBe(base);
    expect(contextFingerprint({ ...BASE_BINDING, runtimeSessionEpoch: 'e2' })).not.toBe(base);
    expect(contextFingerprint({ ...BASE_BINDING, catalogStateToken: 't2' })).not.toBe(base);
    expect(contextFingerprint({ ...BASE_BINDING, engineMode: 'sdk' })).not.toBe(base);
    expect(contextFingerprint({ ...BASE_BINDING, backendIdentity: 'gateway-1' })).not.toBe(base);
    expect(contextFingerprint(BASE_BINDING)).toBe(base);
  });

  it('treats identity-equal bindings as the same for rebind checks', () => {
    const left = { ...BASE_BINDING };
    const right = { ...BASE_BINDING, catalogStateToken: 'different' };
    expect(sameContextIdentity(left, right)).toBe(true);
    expect(sameContextIdentity(left, { ...left, canonicalCwd: '/other' })).toBe(false);
  });
});

describe('stableInvocableId', () => {
  it('varies by runtime type, engine mode, kind, scope, and local key', () => {
    const base = stableInvocableId({
      runtimeType: 'claude',
      engineMode: 'cli',
      kind: 'runtime.command',
      scope: 'project',
      providerLocalKey: 'review',
    });
    expect(
      stableInvocableId({
        runtimeType: 'codex',
        engineMode: 'cli',
        kind: 'runtime.command',
        scope: 'project',
        providerLocalKey: 'review',
      })
    ).not.toBe(base);
    expect(
      stableInvocableId({
        runtimeType: 'claude',
        engineMode: 'sdk',
        kind: 'runtime.command',
        scope: 'project',
        providerLocalKey: 'review',
      })
    ).not.toBe(base);
    expect(
      stableInvocableId({
        runtimeType: 'claude',
        engineMode: 'cli',
        kind: 'runtime.command',
        scope: 'user',
        providerLocalKey: 'review',
      })
    ).not.toBe(base);
    expect(base).toBe(
      stableInvocableId({
        runtimeType: 'claude',
        engineMode: 'cli',
        kind: 'runtime.command',
        scope: 'project',
        providerLocalKey: 'review',
      })
    );
  });
});
