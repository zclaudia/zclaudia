/**
 * Core provider message types — shared across ALL providers.
 *
 * The public definitions live in @zclaudia/plugin-sdk/providers.
 * @zclaudia/shared/providers remains a compatibility re-export for the
 * server's existing import sites.
 */
export type {
  ProviderRuntimeEvent,
  ProviderRuntimeEventType,
  ProviderAssistantDeltaEvent,
  ProviderToolStartedEvent,
  ProviderTurnFinishedEvent,
  SystemInfo,
  ModeTransition,
  ToolInteractionKind,
  PermissionDecision,
  PermissionCallback,
} from '@zclaudia/shared/providers';
export { PROVIDER_RUNTIME_EVENT_TYPES } from '@zclaudia/shared/providers';
