import type {
  ExternalAgentAdapter,
  ExternalAgentRunContext,
  ExternalAgentRunState,
  PermissionCallback,
  ProviderRuntimeEvent,
  ProviderToolBridgeEntry,
  ProviderToolBridgeRequest,
} from '@zclaudia/shared/providers';
import { runCursor, abortCursorSession } from './runner.js';

export type ToolBridgeFactory = (
  req: ProviderToolBridgeRequest
) => Promise<ProviderToolBridgeEntry | null>;

export class CursorAgentAdapter implements ExternalAgentAdapter {
  readonly type = 'cursor';
  private readonly sessionModes = new Map<string, string>();
  private readonly runStates = new WeakMap<ExternalAgentRunContext, ExternalAgentRunState>();
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(private readonly createToolBridge: ToolBridgeFactory) {}

  async *run(
    input: string,
    context: ExternalAgentRunContext,
    _onPermission?: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void> {
    const sessionKey = context.claudiaSessionId ?? context.sessionId ?? '';
    const effectiveMode =
      (sessionKey && this.sessionModes.get(sessionKey)) ?? context.mode;

    const bridge = await this.createToolBridge({
      serverPort: context.serverPort,
      sessionId: context.claudiaSessionId,
    });

    const abortController = context.abortController ?? new AbortController();
    if (sessionKey) {
      this.abortControllers.set(sessionKey, abortController);
    }

    this.runStates.set(context, { providerSessionId: context.sessionId, providerCwd: context.cwd });
    let currentKey = sessionKey;

    try {
      yield* runCursor(input, {
        cwd: context.cwd,
        sessionId: context.sessionId,
        cliPath: context.cliPath,
        env: context.env,
        model: context.model,
        mode: effectiveMode as 'plan' | 'ask' | undefined,
        systemPrompt: context.systemPrompt,
        serverPort: context.serverPort,
        claudiaSessionId: context.claudiaSessionId,
        abortController,
        bridge,
        onSessionId: id => {
          if (id && id !== currentKey) {
            this.abortControllers.delete(currentKey);
            currentKey = id;
            this.abortControllers.set(currentKey, abortController);
          }
          this.runStates.set(context, { providerSessionId: id, providerCwd: context.cwd });
        },
      });
    } finally {
      if (currentKey) {
        this.abortControllers.delete(currentKey);
      }
    }
  }

  getRunState(context: ExternalAgentRunContext): ExternalAgentRunState {
    return this.runStates.get(context) ?? { providerCwd: context.cwd };
  }

  setSessionMode(sessionId: string, mode: string): void {
    if (!sessionId) return;
    this.sessionModes.set(sessionId, mode);
  }

  async abort(sessionId: string, _cwd: string): Promise<void> {
    this.sessionModes.delete(sessionId);
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
    }
    await abortCursorSession(sessionId);
  }
}
