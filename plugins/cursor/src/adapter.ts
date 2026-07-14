import type {
  ExternalAgentAdapter,
  ExternalAgentRunContext,
  ExternalAgentRunState,
  PermissionCallback,
  ProviderRuntimeEvent,
  ProviderToolBridgeEntry,
  ProviderToolBridgeRequest,
} from '@zclaudia/shared/providers';

export type ToolBridgeFactory = (
  req: ProviderToolBridgeRequest
) => Promise<ProviderToolBridgeEntry | null>;

export class CursorAgentAdapter implements ExternalAgentAdapter {
  readonly type = 'cursor';
  private readonly sessionModes = new Map<string, string>();
  private readonly runStates = new WeakMap<ExternalAgentRunContext, ExternalAgentRunState>();

  constructor(private readonly createToolBridge: ToolBridgeFactory) {}

  async *run(
    _input: string,
    context: ExternalAgentRunContext,
    _onPermission?: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void> {
    this.runStates.set(context, { providerSessionId: context.sessionId, providerCwd: context.cwd });
    // Implemented in Task 6
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
    // Process kill wired in Task 6
  }
}
