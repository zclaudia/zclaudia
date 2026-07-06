import type {
  PermissionCallback,
  ProviderAdapter,
  ProviderRuntimeEvent,
  RunOptions,
} from '../types.js';
import { CLAUDE_AGENT_MANIFEST, CLAUDE_AGENT_POLICY } from './manifest.js';
import { buildClaudeCanUseTool } from './permissions.js';
import type { ClaudeAgentRunOptions } from './runner.js';
import { runClaudeAgent } from './runner.js';

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

export class ClaudeAgentAdapter implements ProviderAdapter {
  readonly type = 'claude';
  readonly manifest = CLAUDE_AGENT_MANIFEST;
  readonly policy = CLAUDE_AGENT_POLICY;
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly runStates = new WeakMap<RunOptions, { providerSessionId?: string; providerCwd: string }>();

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
      yield* runClaudeAgent(input, {
        cwd: options.cwd,
        sessionId: options.sessionId,
        env: options.env,
        cliPath: options.cliPath,
        permissionMode: toClaudePermissionMode(options.mode),
        model: options.agentProfile?.model,
        systemPrompt: options.systemPrompt,
        abortController,
        canUseTool: buildClaudeCanUseTool(onPermission),
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
