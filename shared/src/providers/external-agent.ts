// Backward-compatible host entrypoint. The public plugin contract lives in
// @zclaudia/plugin-sdk so external plugins never depend on this workspace.
export type {
  ExternalAgentAdapter,
  ExternalAgentRunContext,
  ExternalAgentRunState,
  ProviderToolBridgeEntry,
  ProviderToolBridgeRequest,
} from '@zclaudia/plugin-sdk/providers';
