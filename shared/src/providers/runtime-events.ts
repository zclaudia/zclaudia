// Backward-compatible host entrypoint. The public plugin contract lives in
// @zclaudia/plugin-sdk so external plugins never depend on this workspace.
export { PROVIDER_RUNTIME_EVENT_TYPES } from '@zclaudia/plugin-sdk/providers';
export type {
  ModeTransition,
  ProviderAssistantDeltaEvent,
  ProviderRuntimeEvent,
  ProviderRuntimeEventType,
  ProviderToolStartedEvent,
  ProviderTurnFinishedEvent,
  SystemInfo,
  ToolInteractionKind,
} from '@zclaudia/plugin-sdk/providers';
