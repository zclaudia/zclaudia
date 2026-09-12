import type {
  ExternalAgentAdapter,
  ExternalAgentRunContext,
  ExternalAgentRunState,
  PermissionCallback,
  ProviderRuntimeEvent,
} from '@zclaudia/plugin-sdk/providers';
import { AdapterSessionState, type ToolBridgeFactory } from '@zclaudia/agent-common';
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

  constructor(private readonly createToolBridge: ToolBridgeFactory) {}

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
