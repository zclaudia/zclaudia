// Backward-compatible host entrypoint. The public plugin contract lives in
// @zclaudia/plugin-sdk so external plugins never depend on this workspace.
import type { ProviderRuntimeEvent as SdkProviderRuntimeEvent } from '@zclaudia/plugin-sdk/providers';
import type { RuntimeUsageSnapshot } from '@zclaudia/shared/core/runtime-usage';

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

/**
 * The bridged usage event. The published SDK (0.4.0) models provider events
 * as one open interface, so the usage variant rides the same shape: plugins
 * emit `{ type: 'provider_usage_updated', snapshot }` (casting at the yield
 * site until the SDK ships the variant), and the host event interface below
 * accepts it without re-narrowing churn at every consumption site.
 */
export interface ProviderUsageUpdatedEvent {
  type: 'provider_usage_updated';
  snapshot: RuntimeUsageSnapshot;
}

/**
 * Host-side provider event surface: the SDK event plus the usage variant.
 * `Omit` + intersection (not interface extension) because widening the
 * discriminating `type` member is only legal on a type intersection.
 */
export type ProviderRuntimeEvent = Omit<SdkProviderRuntimeEvent, 'type'> & {
  type: SdkProviderRuntimeEvent['type'] | 'provider_usage_updated';
  /** Cumulative invocation usage snapshot (runtime usage design §4). */
  snapshot?: RuntimeUsageSnapshot;
  /**
   * On `tool_use` / `tool_started`: the adapter owns this call's process and
   * can move it to a background task via `ProviderAdapter.requestBackgroundForToolCall`.
   * Projected to the wire as `ToolUseMessage.backgroundable`.
   */
  toolBackgroundable?: boolean;
};
