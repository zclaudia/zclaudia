import type { InvocableDescriptor, InvocationRequest } from '@zclaudia/shared/providers';

/**
 * Host Action Registry (URIP design doc §12.4).
 *
 * Host actions are ZClaudia-owned invocables addressed as `/zc:<name>`; their
 * canonical names are unique by construction. Actions either run on the server
 * (`executionLocus: 'server'`) or dispatch a fixed client action
 * (`executionLocus: 'client'`). The server never sends arbitrary instructions
 * to the desktop — only registered action IDs with typed payloads.
 */

export interface HostActionContext {
  sessionId: string;
  /** Raw invocation arguments, validated against the descriptor contract. */
  arguments:
    | { type: 'raw'; value: string }
    | { type: 'structured'; value: Record<string, unknown> };
}

export type HostActionResult =
  | { type: 'completed'; message?: string }
  | { type: 'text'; content: string }
  | { type: 'client-action'; actionId: string; payload?: Record<string, unknown> };

/** Registration-time metadata; the full descriptor is derived in descriptors(). */
export interface HostActionDescriptorInput {
  label: string;
  description?: string;
  aliases?: string[];
  argumentHint?: string;
  origin?: { owner: 'host'; scope: 'system' };
}

export interface HostActionDefinition {
  descriptor: HostActionDescriptorInput;
  /** Where the action body runs. */
  executionLocus: 'server' | 'client';
  /** Required when executionLocus is 'server'. */
  execute?(
    request: { arguments: HostActionContext['arguments'] },
    context: HostActionContext
  ): Promise<HostActionResult>;
  /** Required when executionLocus is 'client': a registered client action ID. */
  clientActionId?: string;
}

const RAW_ARGUMENT_CONTRACT = {
  accepted: ['raw' as const],
  preferred: 'raw' as const,
  transcript: { raw: 'verbatim' as const },
};

export class HostActionRegistry {
  private readonly actions = new Map<string, HostActionDefinition>();

  register(name: string, definition: HostActionDefinition): void {
    const normalized = name.toLowerCase();
    if (this.actions.has(normalized)) {
      throw new Error(`Host action "${normalized}" is already registered`);
    }
    if (definition.executionLocus === 'server' && typeof definition.execute !== 'function') {
      throw new Error(`Host action "${normalized}" with executionLocus server requires execute()`);
    }
    if (definition.executionLocus === 'client' && !definition.clientActionId) {
      throw new Error(
        `Host action "${normalized}" with executionLocus client requires clientActionId`
      );
    }
    this.actions.set(normalized, definition);
  }

  has(name: string): boolean {
    return this.actions.has(name.toLowerCase());
  }

  get(name: string): HostActionDefinition | undefined {
    return this.actions.get(name.toLowerCase());
  }

  /** Canonical descriptors; IDs are assigned by the catalog service. */
  descriptors(): Array<Omit<InvocableDescriptor, 'id'>> {
    return [...this.actions.entries()].map(([name, definition]) => ({
      kind: 'host.action' as const,
      runtimeType: 'host' as const,
      name,
      label: definition.descriptor.label,
      ...(definition.descriptor.description
        ? { description: definition.descriptor.description }
        : {}),
      displayTrigger: `/zc:${name}`,
      ...(definition.descriptor.aliases ? { aliases: definition.descriptor.aliases } : {}),
      ...(definition.descriptor.argumentHint
        ? { argumentHint: definition.descriptor.argumentHint }
        : {}),
      origin: definition.descriptor.origin ?? { owner: 'host' as const, scope: 'system' as const },
      execution: {
        mode: 'host' as const,
        fidelity: 'exact' as const,
        arguments: RAW_ARGUMENT_CONTRACT,
      },
      availability: { available: true } as const,
    }));
  }

  async execute(
    name: string,
    request: InvocationRequest,
    context: HostActionContext
  ): Promise<HostActionResult> {
    const definition = this.get(name);
    if (!definition) {
      throw new Error(`Unknown host action: ${name}`);
    }
    if (definition.executionLocus === 'client') {
      if (!definition.clientActionId) throw new Error(`Client host action is invalid: ${name}`);
      return { type: 'client-action', actionId: definition.clientActionId };
    }
    if (!definition.execute) throw new Error(`Server host action is invalid: ${name}`);
    return (
      (await definition.execute({ arguments: context.arguments }, context)) ?? {
        type: 'completed',
      }
    );
  }
}

/** Global host action registry instance (server-scoped). */
export const hostActionRegistry = new HostActionRegistry();
