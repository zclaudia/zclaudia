import { describe, expect, it } from 'vitest';
import { resolveReservedInvocation } from '../gateway.js';
import { registerDesktopHostActions } from '../host-actions-desktop.js';
import { hostActionRegistry } from '../host-actions.js';
import { stableInvocableId } from '../catalog-service.js';
import { DESKTOP_HOST_ACTIONS } from '@zclaudia/shared/features/host-actions';

describe('reserved-namespace gateway (§12.2)', () => {
  it('resolves /zc:<name> to a client-locus host action', () => {
    registerDesktopHostActions();
    const disposition = resolveReservedInvocation({
      text: '/zc:help',
      runtimeType: 'claude',
    });
    expect(disposition).toEqual({
      kind: 'host-action',
      name: 'help',
      rawArguments: '',
      clientLocus: true,
      clientActionId: 'zc.help',
    });
  });

  it('preserves the argument suffix and resolves with args present', () => {
    registerDesktopHostActions();
    const disposition = resolveReservedInvocation({
      text: '/zc:worktree /repo/../other',
      runtimeType: 'claude',
    });
    expect(disposition).toMatchObject({ kind: 'host-action', name: 'worktree' });
  });

  it('passes unqualified /name through untouched (raw input belongs to the runtime)', () => {
    expect(resolveReservedInvocation({ text: '/review something', runtimeType: 'claude' })).toEqual(
      { kind: 'passthrough' }
    );
    expect(
      resolveReservedInvocation({ text: 'plain text /zc:help', runtimeType: 'claude' })
    ).toEqual({ kind: 'passthrough' });
  });

  it('literal mode bypasses recognition entirely (§12.2 escape)', () => {
    expect(
      resolveReservedInvocation({
        text: '/zc:help',
        runtimeType: 'claude',
        reservedNamespaceMode: 'literal',
      })
    ).toEqual({ kind: 'passthrough' });
  });

  it('rejects unknown reserved names deterministically — no fall-through', () => {
    const disposition = resolveReservedInvocation({
      text: '/zc:does-not-exist',
      runtimeType: 'claude',
    });
    expect(disposition).toEqual({
      kind: 'unresolved',
      namespace: 'zc',
      code: 'INVOCATION_NOT_FOUND',
    });
    expect(resolveReservedInvocation({ text: '/skill:nope', runtimeType: 'claude' })).toEqual({
      kind: 'unresolved',
      namespace: 'skill',
      code: 'INVOCATION_NOT_FOUND',
    });
  });

  it('does not recognize namespaces for the inactive runtime', () => {
    expect(resolveReservedInvocation({ text: '/codex:review', runtimeType: 'claude' })).toEqual({
      kind: 'passthrough',
    });
  });

  it('resolves portable and active-runtime namespaces through the session snapshot', () => {
    const base = {
      id: 'inv1:review',
      kind: 'runtime.command' as const,
      runtimeType: 'claude',
      name: 'review',
      label: 'Review',
      displayTrigger: '/review',
      origin: { owner: 'runtime' as const, scope: 'project' as const },
      execution: {
        mode: 'native-text' as const,
        fidelity: 'exact' as const,
        arguments: {
          accepted: ['raw' as const],
          preferred: 'raw' as const,
          transcript: { raw: 'verbatim' as const },
        },
      },
      availability: { available: true as const },
    };
    const snapshot = {
      protocolVersion: 1 as const,
      revision: 'rev',
      generatedAt: 1,
      contextFingerprint: 'fp',
      phase: 'live' as const,
      completeness: 'complete' as const,
      diagnostics: [],
      invocables: [
        base,
        {
          ...base,
          id: 'inv1:skill',
          kind: 'portable.skill' as const,
          name: 'portable-review',
          displayTrigger: '/skill:portable-review',
        },
      ],
    };

    expect(
      resolveReservedInvocation({
        text: '/claude:review focus on auth',
        runtimeType: 'claude',
        snapshot,
      })
    ).toMatchObject({
      kind: 'catalog-invocation',
      descriptor: { id: 'inv1:review' },
      rawArguments: 'focus on auth',
    });
    expect(
      resolveReservedInvocation({
        text: '/skill:portable-review ticket-1',
        runtimeType: 'claude',
        snapshot,
      })
    ).toMatchObject({
      kind: 'catalog-invocation',
      descriptor: { id: 'inv1:skill' },
      rawArguments: 'ticket-1',
    });
  });
});

describe('desktop host action registration (§12.4)', () => {
  it('registers every canonical action as client-locus with /zc: triggers', () => {
    registerDesktopHostActions();
    for (const action of DESKTOP_HOST_ACTIONS) {
      const definition = hostActionRegistry.get(action.name);
      expect(definition, action.name).toBeDefined();
      expect(definition!.executionLocus).toBe('client');
      expect(definition!.clientActionId).toBe(action.clientActionId);
    }
    const descriptors = hostActionRegistry.descriptors();
    expect(descriptors.map(d => d.displayTrigger)).toContain('/zc:help');
    expect(descriptors.map(d => d.displayTrigger)).toContain('/zc:worktree');
  });

  it('derives canonical IDs offline with the same formula as the catalog service', () => {
    registerDesktopHostActions();
    const help = DESKTOP_HOST_ACTIONS.find(a => a.name === 'help')!;
    const id = stableInvocableId({
      runtimeType: 'host',
      engineMode: 'none',
      kind: 'host.action',
      scope: 'system',
      providerLocalKey: 'help',
    });
    // resolveSubmittedInvocation matches submitted invocableIds against this
    // formula, so the desktop's catalog row and the gateway must agree.
    expect(id).toMatch(/^inv1:/);
    expect(help.clientActionId).toBe('zc.help');
  });
});
