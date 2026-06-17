/**
 * Core provider message types — shared across ALL providers.
 *
 * Kept separate so the runtime Port interface does not depend on a concrete
 * adapter implementation.
 */

import type { Usage } from '@earendil-works/pi-ai';
import type { PermissionRequest } from '@zclaudia/shared/interaction/permissions';
import type { ToolEffect } from '@zclaudia/shared/core/message';
import type { ToolSemantic } from '@zclaudia/shared/wire/messages/run';
import type { ContextWindowSource } from '@zclaudia/shared/wire/messages/core';

export interface PermissionDecision {
  behavior: 'allow' | 'deny';
  updatedInput?: unknown;
  message?: string;
}

export type PermissionCallback = (
  request: PermissionRequest
) => Promise<PermissionDecision>;

export interface ModeTransition {
  /** Canonical target mode (e.g. 'plan', 'default'). */
  mode: string;
  /** 'enter' = entering plan mode, 'exit' = leaving plan mode. */
  reason: 'enter' | 'exit';
  /** Optional plan markdown to surface to the user (typically with reason='exit'). */
  plan?: string;
  /** Tool use id of the tool call that triggered this transition. */
  sourceToolUseId?: string;
}

export type ToolInteractionKind = 'todo_update';

export interface SystemInfo {
  model?: string;
  /** Effective context window in tokens, derived from agent / LLM profile. */
  contextWindow?: number;
  /** Which resolution layer supplied {@link SystemInfo.contextWindow}.
   *  Mirrors the wire-level type so UI can render provenance + warn on
   *  the `fallback` path. */
  contextWindowSource?: ContextWindowSource;
  /** Set when {@link SystemInfo.contextWindowSource} is `pi_ai_registry`;
   *  the pi-ai provider id (same or cross provider) whose registry entry
   *  supplied the contextWindow. Mirrors the wire-level field. */
  contextWindowMatchedProvider?: string;
  claudeCodeVersion?: string;
  cwd?: string;
  tools?: string[];
  mcpServers?: { name: string; status: string }[];
  permissionMode?: string;
  apiKeySource?: string;
  slashCommands?: string[];
  agents?: string[];
}

export const PROVIDER_RUNTIME_EVENT_TYPES = [
  'init',
  'assistant_delta',
  'tool_started',
  'tool_finished',
  'provider_turn_finished',
  'provider_error',
  'task_notification',
  'tool_activity',
  'mode_transition',
  'thinking_delta',
  'retry_scheduled',
] as const;

export type ProviderRuntimeEventType = typeof PROVIDER_RUNTIME_EVENT_TYPES[number];

type LegacyProviderRuntimeEventType =
  | 'assistant'
  | 'result'
  | 'tool_use'
  | 'tool_result'
  | 'error';

export interface ProviderRuntimeEvent {
  type:
    | 'init'
    | 'assistant_delta'
    | 'tool_started'
    | 'tool_finished'
    | 'provider_turn_finished'
    | 'provider_error'
    | 'task_notification'
    | 'tool_activity'
    | 'mode_transition'
    | 'thinking_delta'
    | 'retry_scheduled'
    | LegacyProviderRuntimeEventType;
  /** Populated when type === 'retry_scheduled'. */
  retryInfo?: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    status?: number;
  };
  sessionId?: string;
  content?: string;
  systemInfo?: SystemInfo;
  toolUseId?: string;
  toolName?: string;
  toolInput?: unknown;
  /**
   * Provider-normalized side effect. Provider SDKs/adapters translate their
   * native tool vocabulary into this shape so common layers stay provider-agnostic.
   */
  toolEffect?: ToolEffect;
  /**
   * Provider-normalized interaction kind. Common runtime layers can use this
   * instead of matching provider-native tool names such as `TodoWrite`.
   */
  toolInteractionKind?: ToolInteractionKind;
  /**
   * Provider-supplied semantic tag for the tool. The provider SDK is the only
   * place that knows whether one of its native tools carries a plan proposal
   * or controls plan-mode; it tags those events here so the runtime and UI
   * can react without string-matching tool names.
   */
  toolSemantic?: ToolSemantic;
  toolResult?: unknown;
  isToolError?: boolean;
  error?: string;
  /** Machine-readable error code for structured error handling (e.g. CodexOAuth error codes). */
  errorCode?: string;
  usage?: Usage;
  isComplete?: boolean;
  taskId?: string;
  taskStatus?: string;
  taskMessage?: string;
  taskToolUseId?: string;

  /**
   * Provider-emitted semantic event. The provider SDK is the only place that
   * knows the names of its own plan / mode-switching tools; it normalizes them
   * into this event so the runtime stays provider-agnostic.
   */
  modeTransition?: ModeTransition;

  /** Thinking content chunk (reasoning text from a reasoning-capable model). */
  thinkingContent?: string;
  /** Thinking signature (e.g. Anthropic's encrypted reasoning signature). Set on the
   *  thinking_end event of a block, not during streaming. */
  thinkingSignature?: string;
  /** Whether the thinking block was redacted by safety filters. */
  thinkingRedacted?: boolean;
}

export interface ProviderAssistantDeltaEvent extends ProviderRuntimeEvent {
  type: 'assistant_delta' | 'assistant';
  content: string;
}

export interface ProviderToolStartedEvent extends ProviderRuntimeEvent {
  type: 'tool_started' | 'tool_use';
  toolUseId?: string;
  toolName?: string;
  toolInput?: unknown;
}

export interface ProviderTurnFinishedEvent extends ProviderRuntimeEvent {
  type: 'provider_turn_finished' | 'result';
  content?: string;
  usage?: Usage;
  isComplete?: boolean;
}
