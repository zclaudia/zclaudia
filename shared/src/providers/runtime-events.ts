// shared/src/providers/runtime-events.ts
import type { Usage } from '@earendil-works/pi-ai';
import type { ToolEffect } from '../core/message.js';
import type { ToolSemantic } from '../wire/messages/run.js';
import type { ContextWindowSource } from '../wire/messages/core.js';

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
  contextWindow?: number;
  contextWindowSource?: ContextWindowSource;
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

export type ProviderRuntimeEventType = (typeof PROVIDER_RUNTIME_EVENT_TYPES)[number];

type LegacyProviderRuntimeEventType = 'assistant' | 'result' | 'tool_use' | 'tool_result' | 'error';

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
  retryInfo?: { attempt: number; maxAttempts: number; delayMs: number; status?: number };
  sessionId?: string;
  content?: string;
  systemInfo?: SystemInfo;
  toolUseId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolEffect?: ToolEffect;
  toolInteractionKind?: ToolInteractionKind;
  toolSemantic?: ToolSemantic;
  toolResult?: unknown;
  isToolError?: boolean;
  error?: string;
  errorCode?: string;
  usage?: Usage;
  isComplete?: boolean;
  taskId?: string;
  taskStatus?: string;
  taskMessage?: string;
  taskToolUseId?: string;
  modeTransition?: ModeTransition;
  thinkingContent?: string;
  thinkingSignature?: string;
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
