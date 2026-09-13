import type {
  ExternalAgentAdapter,
  ExternalAgentRunContext,
  ExternalAgentRunState,
  PermissionCallback,
  ProviderRuntimeEvent,
} from '@zclaudia/plugin-sdk/providers';
import type {
  InvocableDescriptor,
  RuntimeInvocationProvider,
  RuntimeTurnInput,
  RuntimeTurnContext,
} from '@zclaudia/plugin-sdk/invocations';
import { InvocationError } from '@zclaudia/plugin-sdk/invocations';
import { AdapterSessionState, type ToolBridgeFactory } from '@zclaudia/agent-common';
import { createClaudeInvocations } from './invocations.js';
import { loadClaudeAgentConfig } from './config.js';
import { buildClaudeCanUseTool } from './permissions.js';
import type { ClaudeAgentRunOptions } from './runner.js';
import { runClaudeAgent } from './runner.js';

type ClaudeMcpServers = NonNullable<ClaudeAgentRunOptions['mcpServers']>;
type ClaudeThinkingOptions = Pick<ClaudeAgentRunOptions, 'thinking' | 'effort'>;

const CLAUDE_PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
]);

function toClaudePermissionMode(mode?: string): ClaudeAgentRunOptions['permissionMode'] {
  return mode && CLAUDE_PERMISSION_MODES.has(mode)
    ? (mode as ClaudeAgentRunOptions['permissionMode'])
    : undefined;
}

function toClaudeThinkingOptions(
  level: ExternalAgentRunContext['thinkingLevel']
): ClaudeThinkingOptions {
  if (!level) return {};
  if (level === 'off') return { thinking: { type: 'disabled' } };
  const effort = level === 'minimal' ? 'low' : level;
  return { thinking: { type: 'adaptive' }, effort };
}

export class ClaudeAgentAdapter implements ExternalAgentAdapter {
  readonly type = 'claude';
  private readonly sessions = new AdapterSessionState();
  readonly invocations: RuntimeInvocationProvider = createClaudeInvocations({
    home: process.env.HOME ?? process.env.USERPROFILE ?? '',
  });

  constructor(private readonly createToolBridge: ToolBridgeFactory) {}

  async *startTurn(
    input: RuntimeTurnInput,
    context: ExternalAgentRunContext,
    onPermission?: Parameters<ClaudeAgentAdapter['run']>[2]
  ): AsyncGenerator<ProviderRuntimeEvent, void, void> {
    switch (input.type) {
      case 'message':
        yield* this.run(input.text, context, onPermission);
        return;
      case 'runtime-invocation': {
        // Native-text execution (§14.1): the exact `/trigger args` text is the
        // native Claude slash-command syntax — nothing is reinterpreted.
        if (input.descriptor.execution.mode !== 'native-text') {
          throw new InvocationError(
            'INVOCATION_ARGUMENTS_INVALID',
            'Claude commands accept freeform text arguments only.'
          );
        }
        const text =
          input.arguments.type === 'raw'
            ? input.arguments.value
              ? `${input.descriptor.displayTrigger} ${input.arguments.value}`
              : input.descriptor.displayTrigger
            : undefined;
        if (text === undefined) {
          throw new InvocationError(
            'INVOCATION_ARGUMENTS_INVALID',
            'Claude commands accept freeform text arguments only.'
          );
        }
        yield* this.run(text, context, onPermission);
        return;
      }
      case 'portable-skill': {
        // Emulated compilation (§13.2): the skill body becomes ordinary
        // prompt text, labeled best-effort; resources cannot be honored.
        if (input.skill.resources) {
          throw new InvocationError(
            'PORTABLE_SKILL_RESOURCE_UNAVAILABLE',
            'Emulated Claude execution cannot provide skill resource files.'
          );
        }
        const compiled =
          input.arguments.type === 'raw' && input.arguments.value
            ? `${input.skill.body}\n\n${input.arguments.value}`
            : input.skill.body;
        yield* this.run(compiled, context, onPermission);
        return;
      }
    }
  }

  async *run(
    input: string,
    context: ExternalAgentRunContext,
    onPermission?: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void> {
    const session = this.sessions.begin(context);

    try {
      const claudeConfig = loadClaudeAgentConfig();
      const bridge = await this.createToolBridge({
        serverPort: context.serverPort,
        sessionId: context.claudiaSessionId,
      });
      // A user-configured MCP server already registered under the bridge's name
      // wins over the injected tool bridge (mirrors the original mergeClaudeMcpServers).
      const mcpServers: ClaudeMcpServers =
        bridge && !claudeConfig.mcpServers[bridge.name]
          ? { ...claudeConfig.mcpServers, [bridge.name]: bridge.config as ClaudeMcpServers[string] }
          : claudeConfig.mcpServers;
      const thinkingOptions = toClaudeThinkingOptions(context.thinkingLevel);
      yield* runClaudeAgent(input, {
        cwd: context.cwd,
        sessionId: context.sessionId,
        env: context.env,
        cliPath: context.cliPath,
        permissionMode: toClaudePermissionMode(context.mode),
        model: context.model,
        ...thinkingOptions,
        systemPrompt: context.systemPrompt,
        abortController: session.abortController,
        canUseTool: buildClaudeCanUseTool(onPermission),
        mcpServers,
        plugins: claudeConfig.plugins,
        engineExecution: context.engineExecution,
        modelConnection: context.modelConnection,
        onSessionId: sessionId => {
          this.sessions.registerProviderSession(session, sessionId);
        },
      });
    } finally {
      this.sessions.finish(session);
    }
  }

  getRunState(context: ExternalAgentRunContext): ExternalAgentRunState {
    return this.sessions.getRunState(context);
  }

  async abort(sessionId: string): Promise<void> {
    this.sessions.abort(sessionId);
  }

  dispose(): void {
    this.sessions.abortAll();
  }
}
