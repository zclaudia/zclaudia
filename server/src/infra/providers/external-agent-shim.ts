import type {
  AgentRuntimeDescriptor,
  ExternalAgentAdapter,
  ExternalAgentRunContext,
} from '@zclaudia/shared/providers';
import type { ProviderAdapter, RunOptions } from './types.js';

export function toExternalAgentRunContext(options: RunOptions): ExternalAgentRunContext {
  return {
    cwd: options.cwd,
    sessionId: options.sessionId,
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
  };
}

export function wrapExternalAgentAdapter(
  ext: ExternalAgentAdapter,
  descriptor: AgentRuntimeDescriptor
): ProviderAdapter {
  return {
    type: ext.type,
    manifest: descriptor.manifest,
    policy: descriptor.policy,
    async *run(input, options, onPermission) {
      yield* ext.run(input, toExternalAgentRunContext(options), onPermission);
    },
    abort: ext.abort ? (sessionId, cwd) => ext.abort!(sessionId, cwd) : undefined,
    getRunState: ext.getRunState
      ? options =>
          ext.getRunState!(toExternalAgentRunContext(options)) as unknown as Record<
            string,
            unknown
          >
      : undefined,
    setSessionMode: ext.setSessionMode
      ? (sessionId, mode) => ext.setSessionMode!(sessionId, mode)
      : undefined,
  };
}
