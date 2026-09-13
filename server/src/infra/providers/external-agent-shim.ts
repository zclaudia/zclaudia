import type {
  AgentRuntimeDescriptor,
  ExternalAgentAdapter,
  ExternalAgentRunContext,
  RuntimeTurnContext,
} from '@zclaudia/shared/providers';
import { InvocationError } from '@zclaudia/shared/providers';
import type { ProviderAdapter, RunOptions } from './types.js';

export function toExternalAgentRunContext(options: RunOptions): ExternalAgentRunContext {
  return {
    cwd: options.cwd,
    sessionId: options.sessionId,
    providerTransport: options.providerTransport,
    env: options.env,
    mode: options.mode,
    systemPrompt: options.systemPrompt,
    sessionTitle: options.sessionTitle,
    serverPort: options.serverPort,
    claudiaSessionId: options.claudiaSessionId,
    thinkingLevel: options.thinkingLevel,
    model: options.agentProfile?.model?.trim() || undefined,
    cliPath: options.agentProfile?.cliPath?.trim() || options.cliPath,
    abortController: options.abortController,
    // Dual-mode run contract. modelConnection carries the run's API key and is
    // in-memory only: it must never be logged, traced, or persisted downstream.
    engineExecution: options.engineExecution,
    modelConnection: options.modelConnection,
  };
}

function toRuntimeTurnContext(options: RunOptions): RuntimeTurnContext {
  return {
    ...toExternalAgentRunContext(options),
    services: {
      portableSkillResources: {
        read: async () => {
          throw new InvocationError(
            'PORTABLE_SKILL_RESOURCE_UNAVAILABLE',
            'Portable skill resource handles are not available on this host transport.'
          );
        },
      },
    },
  };
}

export function wrapExternalAgentAdapter(
  ext: ExternalAgentAdapter,
  descriptor: AgentRuntimeDescriptor,
  onRunStart?: (context: ExternalAgentRunContext) => () => void
): ProviderAdapter {
  if (ext.type !== descriptor.type) {
    throw new Error(
      `External agent adapter type "${ext.type}" does not match descriptor type "${descriptor.type}"`
    );
  }
  return {
    type: ext.type,
    manifest: descriptor.manifest,
    policy: descriptor.policy,
    // URIP runtime catalog source (§21): forwarded so the host catalog
    // service discovers through the owning adapter only.
    invocations: (
      ext as unknown as {
        invocations?: import('@zclaudia/shared/providers').RuntimeInvocationProvider;
      }
    ).invocations,
    async *run(input, options, onPermission) {
      const context = toRuntimeTurnContext(options);
      const release = onRunStart?.(context);
      try {
        yield* ext.run(input, context, onPermission);
      } finally {
        release?.();
      }
    },
    // URIP V2 forwarding (§21): typed turn inputs reach adapters that
    // implement startTurn; the complete run context still flows through
    // toExternalAgentRunContext so cancellation and approval are shared.
    startTurn:
      typeof (ext as { startTurn?: unknown }).startTurn === 'function'
        ? (input, options, onPermission) => {
            const context = toRuntimeTurnContext(options);
            const release = onRunStart?.(context);
            const stream = (
              ext as unknown as {
                startTurn: (
                  input: unknown,
                  context: unknown,
                  onPermission: unknown
                ) => AsyncGenerator<
                  import('@zclaudia/shared/providers').ProviderRuntimeEvent,
                  void,
                  void
                >;
              }
            ).startTurn(input, context, onPermission);
            return (async function* () {
              try {
                yield* stream;
              } finally {
                release?.();
              }
            })();
          }
        : undefined,
    abort: ext.abort ? (sessionId, cwd) => ext.abort!(sessionId, cwd) : undefined,
    getRunState: ext.getRunState
      ? options =>
          ext.getRunState!(toExternalAgentRunContext(options)) as unknown as Record<string, unknown>
      : undefined,
    setSessionMode: ext.setSessionMode
      ? (sessionId, mode) => ext.setSessionMode!(sessionId, mode)
      : undefined,
  };
}
