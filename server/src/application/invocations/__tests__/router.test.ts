import { describe, expect, it } from 'vitest';
import type { InvocableCatalogSnapshot } from '@zclaudia/shared/providers';
import { resolveInvocation, deriveTranscriptText } from '../router.js';
import { contextFingerprint, type CatalogContextBinding } from '../catalog-service.js';
import { registerDesktopHostActions } from '../host-actions-desktop.js';

const BINDING: CatalogContextBinding = {
  backendIdentity: 'local',
  sessionId: 'session-1',
  runtimeType: 'claude',
  engineMode: 'cli',
  canonicalCwd: '/repo',
  configurationRootFingerprint: 'cfg-1',
  settingsSourcePolicy: ['user', 'project'],
  catalogPhase: 'live',
};
const FINGERPRINT = contextFingerprint(BINDING);

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv1:abc',
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
    ...overrides,
  };
}

function snapshot(invocables: ReturnType<typeof descriptor>[]): InvocableCatalogSnapshot {
  return {
    protocolVersion: 1,
    revision: 'rev-current',
    generatedAt: Date.now(),
    contextFingerprint: FINGERPRINT,
    phase: 'live',
    completeness: 'complete',
    invocables: invocables as InvocableCatalogSnapshot['invocables'],
    diagnostics: [],
  };
}

function makeDeps(
  invocables: ReturnType<typeof descriptor>[],
  overrides: Partial<Parameters<typeof resolveInvocation>[1]> = {}
) {
  return {
    currentBinding: BINDING,
    currentSnapshot: snapshot(invocables),
    snapshotByRevision: () => snapshot(invocables),
    recordFor: (id: string) => ({
      descriptor: invocables.find(i => i.id === id) ?? invocables[0],
      nativeLocator: { file: 'review.md' },
    }),
    ...overrides,
  } as Parameters<typeof resolveInvocation>[1];
}

const REQUEST = {
  invocableId: 'inv1:abc',
  catalogRevision: 'rev-current',
  contextFingerprint: FINGERPRINT,
  arguments: { type: 'raw' as const, value: 'focus on auth' },
};

describe('resolveInvocation', () => {
  it('resolves a runtime invocation to a typed turn input with server-derived transcript', async () => {
    const resolution = await resolveInvocation(REQUEST, makeDeps([descriptor()]));
    expect(resolution.transcriptText).toBe('/review focus on auth');
    expect(resolution.turnInput).toMatchObject({
      type: 'runtime-invocation',
      nativeLocator: { file: 'review.md' },
    });
    expect(resolution.metadata).toMatchObject({
      invocableId: 'inv1:abc',
      executionMode: 'native-text',
      argumentType: 'raw',
    });
  });

  it('rejects a tampered context fingerprint before anything executes', async () => {
    await expect(
      resolveInvocation({ ...REQUEST, contextFingerprint: 'forged' }, makeDeps([descriptor()]))
    ).rejects.toMatchObject({ code: 'INVOCATION_CONTEXT_CHANGED' });
  });

  it('rejects unknown invocables and unavailable entries', async () => {
    await expect(
      resolveInvocation({ ...REQUEST, invocableId: 'inv1:gone' }, makeDeps([descriptor()]))
    ).rejects.toMatchObject({ code: 'INVOCATION_NOT_FOUND' });

    await expect(
      resolveInvocation(
        REQUEST,
        makeDeps([
          descriptor({
            availability: { available: false, reason: 'CLI too old', code: 'UNSUPPORTED' },
          }),
        ])
      )
    ).rejects.toMatchObject({ code: 'INVOCATION_UNAVAILABLE' });
  });

  it('rejects argument representations the descriptor does not accept', async () => {
    await expect(
      resolveInvocation(
        { ...REQUEST, arguments: { type: 'structured', value: { deep: true } } },
        makeDeps([descriptor()])
      )
    ).rejects.toMatchObject({ code: 'INVOCATION_ARGUMENTS_INVALID' });
  });

  it('rejects context changes (cwd/mode/phase) via the recomputed binding fingerprint', async () => {
    const deps = makeDeps([descriptor()]);
    deps.currentSnapshot = {
      ...snapshot([descriptor()]),
      contextFingerprint: 'fingerprint-after-cwd-change',
    };
    await expect(resolveInvocation(REQUEST, deps)).rejects.toMatchObject({
      code: 'INVOCATION_CONTEXT_CHANGED',
    });
  });

  it('routes host actions to the host registry, never to a provider turn', async () => {
    registerDesktopHostActions();
    const hostDescriptor = descriptor({
      id: 'inv1:host',
      kind: 'host.action',
      runtimeType: 'host',
      name: 'help',
      displayTrigger: '/zc:help',
      execution: {
        mode: 'host',
        fidelity: 'exact',
        arguments: { accepted: ['raw'], preferred: 'raw', transcript: { raw: 'omit-arguments' } },
      },
    });
    const resolution = await resolveInvocation(
      { ...REQUEST, invocableId: 'inv1:host', arguments: { type: 'raw', value: 'extra' } },
      makeDeps([hostDescriptor])
    );
    expect(resolution.turnInput).toBeUndefined();
    expect(resolution.hostAction).toEqual({
      name: 'help',
      locus: 'client',
      clientActionId: 'zc.help',
    });
    expect(resolution.transcriptText).toBe('/zc:help');
  });

  it('materializes portable skills and fails unsupported ones before a provider turn', async () => {
    const skill = descriptor({
      id: 'inv1:skill',
      kind: 'portable.skill',
      displayTrigger: '/skill:review',
      execution: {
        mode: 'bridged',
        fidelity: 'best-effort',
        arguments: { accepted: ['raw'], preferred: 'raw', transcript: { raw: 'verbatim' } },
      },
    });
    const materialized = {
      id: 'review',
      name: 'review',
      description: '',
      body: 'SKILL BODY',
      metadata: {},
      contentDigest: 'd1',
    };
    const ok = await resolveInvocation(
      { ...REQUEST, invocableId: 'inv1:skill' },
      makeDeps([skill], {
        assessPortableSkill: () => ({
          supported: true,
          mode: 'context',
          executionMode: 'bridged',
          fidelity: 'best-effort',
          resourceAccess: 'none',
        }),
        materializePortableSkill: async () => materialized,
      })
    );
    expect(ok.turnInput).toMatchObject({
      type: 'portable-skill',
      skill: { body: 'SKILL BODY' },
      assessment: { supported: true },
    });

    await expect(
      resolveInvocation(
        { ...REQUEST, invocableId: 'inv1:skill' },
        makeDeps([skill], {
          assessPortableSkill: () => ({
            supported: false,
            mode: 'unsupported',
            code: 'NO_CONTEXT_CHANNEL',
            reason: 'Runtime has no context channel for skills.',
          }),
          materializePortableSkill: async () => materialized,
        })
      )
    ).rejects.toMatchObject({ code: 'PORTABLE_SKILL_UNSUPPORTED' });
  });
});

describe('deriveTranscriptText (server-owned transcript authority)', () => {
  it('appends raw arguments verbatim and honors omit-arguments', () => {
    const base = descriptor();
    expect(deriveTranscriptText(base, { type: 'raw', value: '  spaced "args"  ' })).toBe(
      '/review   spaced "args"  '
    );
    expect(
      deriveTranscriptText(
        descriptor({
          execution: {
            mode: 'native-text',
            fidelity: 'exact',
            arguments: {
              accepted: ['raw'],
              preferred: 'raw',
              transcript: { raw: 'omit-arguments' },
            },
          },
        }),
        { type: 'raw', value: 'secret args' }
      )
    ).toBe('/review');
  });

  it('renders structured arguments with stable field ordering and writeOnly redaction', () => {
    const structured = descriptor({
      execution: {
        mode: 'native-structured',
        fidelity: 'exact',
        arguments: {
          accepted: ['structured'],
          preferred: 'structured',
          schema: {
            type: 'object',
            properties: {
              zeta: { type: 'string' },
              alpha: { type: 'string' },
              secret: { type: 'string', writeOnly: true },
            },
          },
          transcript: { structured: 'schema-redacted' },
        },
      },
    });
    const text = deriveTranscriptText(structured, {
      type: 'structured',
      value: { zeta: 'last', alpha: 'first', secret: 'hunter2' },
    });
    expect(text).toBe('/review --alpha="first" --zeta="last"');
    expect(text).not.toContain('hunter2');
  });

  it('redacts nested writeOnly values and validates structured arguments with JSON Schema', async () => {
    const structured = descriptor({
      execution: {
        mode: 'native-structured',
        fidelity: 'exact',
        arguments: {
          accepted: ['structured'],
          preferred: 'structured',
          schema: {
            type: 'object',
            required: ['config'],
            properties: {
              config: { $ref: '#/$defs/config' },
            },
            $defs: {
              config: {
                type: 'object',
                required: ['target'],
                properties: {
                  target: { type: 'string' },
                  token: { type: 'string', writeOnly: true },
                },
              },
            },
          },
          transcript: { structured: 'schema-redacted' },
        },
      },
    });
    const text = deriveTranscriptText(structured, {
      type: 'structured',
      value: { config: { target: 'staging', token: 'nested-secret' } },
    });
    expect(text).toContain('staging');
    expect(text).not.toContain('nested-secret');

    await expect(
      resolveInvocation(
        {
          ...REQUEST,
          arguments: { type: 'structured', value: { config: { target: 42 } } },
        },
        makeDeps([structured])
      )
    ).rejects.toMatchObject({ code: 'INVOCATION_ARGUMENTS_INVALID' });
  });
});
