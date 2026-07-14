import type {
  ExternalAgentAdapter,
  ExternalAgentRunContext,
  PermissionCallback,
  ProviderRuntimeEvent,
  ProviderToolBridgeEntry,
  ProviderToolBridgeRequest,
} from '@zclaudia/shared/providers';

export type ToolBridgeFactory = (
  req: ProviderToolBridgeRequest
) => Promise<ProviderToolBridgeEntry | null>;

export class CodexAgentAdapter implements ExternalAgentAdapter {
  readonly type = 'codex';

  constructor(private readonly createToolBridge: ToolBridgeFactory) {}

  async *run(
    _input: string,
    _context: ExternalAgentRunContext,
    _onPermission?: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void> {
    yield { type: 'provider_error', error: 'Codex adapter not implemented' };
  }
}
