// Backward-compatible host entrypoint. The public plugin contract lives in
// @zclaudia/plugin-sdk so external plugins never depend on this workspace.
import type { ProviderRuntimeEvent as SdkProviderRuntimeEvent } from '@zclaudia/plugin-sdk/providers';

export { PROVIDER_RUNTIME_EVENT_TYPES } from '@zclaudia/plugin-sdk/providers';
export type {
  ModeTransition,
  ProviderAssistantDeltaEvent,
  ProviderRuntimeEventType,
  ProviderToolStartedEvent,
  ProviderTurnFinishedEvent,
  SystemInfo,
  ToolInteractionKind,
} from '@zclaudia/plugin-sdk/providers';
export type { SdkProviderRuntimeEvent };

export type { ProviderUsageUpdatedEvent } from '@zclaudia/plugin-sdk/usage';

/** Host-side provider event surface: the SDK event plus host-only fields. */
export type ProviderRuntimeEvent = SdkProviderRuntimeEvent & {
  /**
   * On `tool_use` / `tool_started`: the adapter owns this call's process and
   * can move it to a background task via `ProviderAdapter.requestBackgroundForToolCall`.
   * Projected to the wire as `ToolUseMessage.backgroundable`.
   */
  toolBackgroundable?: boolean;
};
