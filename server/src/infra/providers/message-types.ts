/**
 * Core provider message types — shared across ALL providers.
 *
 * The type definitions now live in @zclaudia/shared/providers so plugins can
 * implement the external-agent contract. This module re-exports them for the
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
