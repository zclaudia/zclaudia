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
  claudeCodeVersion?: string;
  cwd?: string;
  tools?: string[];
  mcpServers?: { name: string; status: string }[];
  permissionMode?: string;
  apiKeySource?: string;
  slashCommands?: string[];
  agents?: string[];
}

export interface ClaudeMessage {
  type:
    | 'init'
    | 'assistant'
    | 'result'
    | 'tool_use'
    | 'tool_result'
    | 'error'
    | 'task_notification'
    | 'tool_activity'
    | 'mode_transition'
    | 'thinking_delta';
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
