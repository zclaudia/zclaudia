import { parseReservedNamespace } from './namespace-parser.js';
import { hostActionRegistry } from './host-actions.js';
import type { InvocableCatalogSnapshot, InvocableDescriptor } from '@zclaudia/shared/providers';

/**
 * Reserved-namespace gateway for message-branch submissions (URIP §12.2).
 *
 * Applied server-side BEFORE generic message routing. Recognizes only a
 * byte-zero token `/zc:<name>`, `/skill:<name>`, or `/<active-runtime>:<name>`;
 * everything else — including unqualified `/name` — passes through untouched.
 * `reservedNamespaceMode: 'literal'` (explicit "send literally") bypasses
 * recognition entirely.
 */

export type ReservedInvocationDisposition =
  /** Not a reserved namespace: continue generic message routing unchanged. */
  | { kind: 'passthrough' }
  /** Host action: execute server-side or hand the client-action ID back. */
  | {
      kind: 'host-action';
      name: string;
      rawArguments: string;
      clientLocus: boolean;
      clientActionId?: string;
    }
  /** A reserved portable/runtime name resolved to its canonical catalog row. */
  | { kind: 'catalog-invocation'; descriptor: InvocableDescriptor; rawArguments: string }
  /** Reserved namespace recognized but the name does not resolve — never falls through. */
  | { kind: 'unresolved'; namespace: 'zc' | 'skill' | 'runtime'; code: 'INVOCATION_NOT_FOUND' };

export interface ResolveReservedInput {
  text: string;
  /** Active runtime type for `/<runtime>:<name>` recognition. */
  runtimeType: string;
  /** Fresh session catalog used for `/skill:` and `/<runtime>:` lookup. */
  snapshot?: InvocableCatalogSnapshot;
  /** Explicit literal-send escape. */
  reservedNamespaceMode?: 'resolve' | 'literal';
}

export function resolveReservedInvocation(
  input: ResolveReservedInput
): ReservedInvocationDisposition {
  if (input.reservedNamespaceMode === 'literal') return { kind: 'passthrough' };
  const parsed = parseReservedNamespace(input.text, { activeRuntimeType: input.runtimeType });
  if (!parsed) return { kind: 'passthrough' };

  if (parsed.namespace === 'zc') {
    const definition = hostActionRegistry.get(parsed.name);
    if (!definition || !hostActionRegistry.has(parsed.name)) {
      // Unknown names inside a reserved namespace reject deterministically
      // (§12.2) — they never fall through to the runtime.
      return { kind: 'unresolved', namespace: 'zc', code: 'INVOCATION_NOT_FOUND' };
    }
    return {
      kind: 'host-action',
      name: parsed.name,
      rawArguments: parsed.argumentSuffix,
      clientLocus: definition.executionLocus === 'client',
      ...(definition.clientActionId ? { clientActionId: definition.clientActionId } : {}),
    };
  }

  const descriptor = input.snapshot?.invocables.find(item => {
    if (item.name.toLowerCase() !== parsed.name) return false;
    if (parsed.namespace === 'skill') return item.kind === 'portable.skill';
    return item.runtimeType === input.runtimeType && item.kind !== 'portable.skill';
  });
  if (descriptor) {
    return { kind: 'catalog-invocation', descriptor, rawArguments: parsed.argumentSuffix };
  }
  return { kind: 'unresolved', namespace: parsed.namespace, code: 'INVOCATION_NOT_FOUND' };
}
