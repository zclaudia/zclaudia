import type {
  PermissionCallback,
  ProviderAdapter,
  ProviderRuntimeEvent,
  RunOptions,
} from '../../types.js';
import {
  createAgentPluginToolBridgeMcpEntry,
  DEFAULT_AGENT_PLUGIN_BRIDGE_MCP_SERVER_NAME,
} from '../agent-plugin/tool-bridge.js';
import { loadClaudeAgentConfig } from './config.js';
import { CLAUDE_AGENT_MANIFEST, CLAUDE_AGENT_POLICY } from './manifest.js';
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

function mergeClaudeMcpServers(
  base: ClaudeMcpServers,
  bridgeEntry: ClaudeMcpServers[string] | null
): ClaudeMcpServers {
  if (!bridgeEntry) return base;
  if (base[DEFAULT_AGENT_PLUGIN_BRIDGE_MCP_SERVER_NAME]) return base;
  return {
    ...base,
    [DEFAULT_AGENT_PLUGIN_BRIDGE_MCP_SERVER_NAME]: bridgeEntry,
  };
}

function toClaudeThinkingOptions(level: RunOptions['thinkingLevel']): ClaudeThinkingOptions {
  if (!level) return {};
  if (level === 'off') return { thinking: { type: 'disabled' } };
  const effort = level === 'minimal' ? 'low' : level;
  return {
    thinking: { type: 'adaptive' },
    effort,
  };
}

export class ClaudeAgentAdapter implements ProviderAdapter {
  readonly type = 'claude';
  readonly manifest = CLAUDE_AGENT_MANIFEST;
  readonly policy = CLAUDE_AGENT_POLICY;
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly runStates = new WeakMap<
    RunOptions,
    { providerSessionId?: string; providerCwd: string }
  >();

  async *run(
    input: string,
    options: RunOptions,
    onPermission?: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void> {
    const key = options.sessionId || options.claudiaSessionId || `pending:${Date.now()}`;
    const abortController = options.abortController ?? new AbortController();
    this.abortControllers.set(key, abortController);
    this.runStates.set(options, {
      providerSessionId: options.sessionId,
      providerCwd: options.cwd,
    });
    let currentKey = key;

    try {
      const claudeConfig = loadClaudeAgentConfig();
      const bridgeEntry = await createAgentPluginToolBridgeMcpEntry({
        serverPort: options.serverPort,
        zclaudiaSessionId: options.claudiaSessionId,
      });
      const mcpServers = mergeClaudeMcpServers(claudeConfig.mcpServers, bridgeEntry);
      const model = options.agentProfile?.model?.trim() || undefined;
      const cliPath = options.agentProfile?.cliPath?.trim() || options.cliPath;
      const thinkingOptions = toClaudeThinkingOptions(options.thinkingLevel);
      yield* runClaudeAgent(input, {
        cwd: options.cwd,
        sessionId: options.sessionId,
        env: options.env,
        cliPath,
        permissionMode: toClaudePermissionMode(options.mode),
        model,
        ...thinkingOptions,
        systemPrompt: options.systemPrompt,
        abortController,
        canUseTool: buildClaudeCanUseTool(onPermission),
        mcpServers,
        plugins: claudeConfig.plugins,
        onSessionId: sessionId => {
          if (sessionId && sessionId !== currentKey) {
            this.abortControllers.delete(currentKey);
            currentKey = sessionId;
            this.abortControllers.set(currentKey, abortController);
          }
          this.runStates.set(options, {
            providerSessionId: sessionId,
            providerCwd: options.cwd,
          });
        },
      });
    } finally {
      this.abortControllers.delete(currentKey);
    }
  }

  getRunState(options: RunOptions): Record<string, unknown> {
    return this.runStates.get(options) ?? { providerCwd: options.cwd };
  }

  async abort(sessionId: string): Promise<void> {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
    }
  }

  trackAbortControllerForTest(sessionId: string, controller: AbortController): void {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('trackAbortControllerForTest is test-only');
    }
    this.abortControllers.set(sessionId, controller);
  }
}
