/**
 * Run lifecycle messages: start, cancel, deltas, tool use/result, mode changes,
 * completion/failure, background tasks, agent assistant, and process cleanup.
 */

import type { SessionType } from '../../core/session.js';
import type { ContentBlock, ToolEffect, UsageInfo } from '../../core/message.js';
import type { PCPEffectiveProfile } from '../../core/pcp.js';
import type { UnifiedPermissionPolicy } from '../../interaction/permissions.js';
import type { InvocationRequest, RuntimeAttachment } from '@zclaudia/plugin-sdk/invocations';

export interface RunStartMessage {
  type: 'run_start';
  clientRequestId: string;
  sessionId: string;
  input: string;
  llmProfileId?: string;
  /** User-selected mode id (matches one of `ProviderCapabilities.modes`).
   *  Adapter derives PCP `permissionMode` from this. Typical values:
   *  `'default'` | `'plan'`. Other values can be added by extending
   *  ProviderCapabilities.modes without touching this wire schema. */
  mode?: string;
  permissionOverride?: Partial<UnifiedPermissionPolicy>;
  systemContext?: string;
  workingDirectory?: string;
  resend?: boolean;
}

/**
 * Typed turn input for the versioned run_start (URIP design doc §15.2).
 *
 * `message` carries text plus first-class attachments; `reservedNamespaceMode`
 * defaults to `resolve` (the server resolves `/zc:`/`/skill:`/runtime
 * namespaces), and `literal` is set only by an explicit "send literally" UI
 * action. `invocation` submits a canonical catalog selection; its context is
 * derived from the referenced session snapshot, so `mode`/`workingDirectory`
 * must not accompany it.
 */
export type RunTurnInput =
  | {
      type: 'message';
      text: string;
      attachments?: RuntimeAttachment[];
      reservedNamespaceMode?: 'resolve' | 'literal';
    }
  | {
      type: 'invocation';
      request: InvocationRequest;
      attachments?: RuntimeAttachment[];
    };

/**
 * Versioned run_start. V2 clients send `turnInput`; legacy clients keep sending
 * the plain `input` string (which may JSON-encode `{ text, attachments }` —
 * the server normalizes both). A V2 invocation cannot override mode or working
 * directory: the server rejects the combination.
 */
export interface RunStartMessageV2 {
  type: 'run_start';
  protocolVersion: 2;
  clientRequestId: string;
  sessionId: string;
  turnInput: RunTurnInput;
  llmProfileId?: string;
  /** Message-branch only: user-selected mode id. */
  mode?: string;
  permissionOverride?: Partial<UnifiedPermissionPolicy>;
  systemContext?: string;
  /** Message-branch only: never rebinds a selected invocation. */
  workingDirectory?: string;
  resend?: boolean;
}

/**
 * Normalize a legacy `run_start.input` string. The desktop client JSON-encodes
 * `{ text, attachments }` into the string channel today; a naive
 * `{ type: 'message', text: input }` mapping would silently drop attachments.
 */
export function normalizeLegacyRunInput(input: string): {
  text: string;
  attachments?: RuntimeAttachment[];
} {
  if (input.startsWith('{')) {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof (parsed as { text?: unknown }).text === 'string'
      ) {
        const record = parsed as { text: string; attachments?: RuntimeAttachment[] };
        return {
          text: record.text,
          ...(Array.isArray(record.attachments) ? { attachments: record.attachments } : {}),
        };
      }
    } catch {
      // Plain text that happens to start with '{'.
    }
  }
  return { text: input };
}

/** Server → client notification that the session's invocable catalog changed. */
export interface InvocableCatalogChangedMessage {
  type: 'invocable_catalog_changed';
  sessionId: string;
  revision: string;
  reason:
    | 'filesystem'
    | 'runtime-event'
    | 'runtime-initialized'
    | 'session-reset'
    | 'engine-mode'
    | 'cwd'
    | 'plugin-reload'
    | 'manual';
}

export interface RunCancelMessage {
  type: 'run_cancel';
  runId: string;
}

export interface RunSteerMessage {
  type: 'run_steer';
  runId: string;
  content: string;
}

export interface MessageAppendedMessage {
  type: 'message_appended';
  sessionId: string;
  runId: string;
  role: 'user';
  content: string;
  /** True when the message was injected mid-run via steer (vs normal send). UI may show a marker. */
  steered?: boolean;
  timestamp: number;
}

export interface RunStartedMessage {
  type: 'run_started';
  runId: string;
  sessionId: string;
  clientRequestId: string;
  /** Real DB message ID for the user message (for client-side dedup) */
  userMessageId?: string;
  /** Real DB message ID for the assistant message (for client-side dedup) */
  assistantMessageId?: string;
  /** Session type — background runs should not affect the session's loading state */
  sessionType?: SessionType;
  /** Monotonically increasing event sequence number within this run (starts at 1) */
  seq?: number;
  /** PCP effective provider profile for this run */
  effectiveProfile?: PCPEffectiveProfile;
}

export interface SessionCreatedMessage {
  type: 'session_created';
  sessionId: string;
  sdkSessionId?: string;
}

export interface DeltaMessage {
  type: 'delta';
  runId: string;
  sessionId: string;
  content: string;
  seq?: number;
}

/**
 * Provider-declared semantic category for a tool call. Used by the UI to pick
 * the right renderer (and by the runtime for cross-provider behaviors) without
 * hardcoding provider-specific tool names. Each provider's SDK is responsible
 * for tagging its own tools with the appropriate semantic; the common layers
 * never branch on `toolName`.
 */
export type ToolSemantic =
  /** Tool call whose input.plan carries a markdown plan to render to the user. */
  | 'plan_proposal'
  /** Tool call that transitions the session into plan mode. */
  | 'plan_enter'
  /** Tool call that transitions the session out of plan mode. */
  | 'plan_exit';

export interface ToolUseMessage {
  type: 'tool_use';
  runId: string;
  sessionId: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  /** Optional provider-declared semantic category. See {@link ToolSemantic}. */
  semantic?: ToolSemantic;
  /** Provider-normalized side effect; common UI consumes this instead of provider tool names. */
  effect?: ToolEffect;
  seq?: number;
}

export interface ToolResultMessage {
  type: 'tool_result';
  runId: string;
  sessionId: string;
  toolUseId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
  /** Provider-normalized side effect discovered when the tool completed. */
  effect?: ToolEffect;
  seq?: number;
}

export interface ToolActivityMessage {
  type: 'tool_activity';
  runId: string;
  sessionId: string;
  toolUseId: string;
  content: string;
  seq?: number;
}

export interface ModeChangeMessage {
  type: 'mode_change';
  runId: string;
  sessionId: string;
  mode: string;
  seq?: number;
}

export interface RunCompletedMessage {
  type: 'run_completed';
  runId: string;
  sessionId: string;
  usage?: UsageInfo;
  /** Stable persisted row targeted by this terminal snapshot. */
  assistantMessageId?: string;
  /** Session message revision after the final assistant row was persisted. */
  messageVersion?: number;
  /** Authoritative final assistant text. Live clients accumulate the message
   *  from streamed deltas; a lost delta frame would otherwise leave the
   *  rendered message truncated until a full history reload. */
  content?: string;
  contentBlocks?: ContentBlock[];
  seq?: number;
}

/**
 * Emitted after the session_compactions row is persisted. Carries ids only —
 * clients fetch full marker details via `GET /api/sessions/:sid/compactions/:cid`.
 * `runId` is set when compaction is triggered automatically inside a run (the
 * common auto-compaction path); it is omitted for manual `/compact` runs which
 * fire outside a run context.
 */
export interface CompactionCompletedEvent {
  type: 'compaction_completed';
  runId?: string;
  sessionId: string;
  compactionId: string;
  tokensBefore: number;
}

/**
 * Emitted when an automatic compaction attempt fails (the summarizer LLM call
 * errored). `breakerOpen` is true once consecutive failures reach the threshold
 * — subsequent turns will skip compaction during the cooldown. Clients surface a
 * non-blocking notice when breakerOpen so the user can run /compact or start a
 * fresh session.
 */
export interface CompactionFailedEvent {
  type: 'compaction_failed';
  runId?: string;
  sessionId: string;
  reason: string;
  breakerOpen: boolean;
  nextRetryAtMs?: number;
}

export interface RunFailedMessage {
  type: 'run_failed';
  runId: string;
  sessionId: string;
  error: string;
  /** Machine-readable error code for structured error handling (e.g. CodexOAuth error codes). */
  errorCode?: string;
  /** Persisted partial assistant snapshot, when the run produced output before failing. */
  assistantMessageId?: string;
  messageVersion?: number;
  content?: string;
  contentBlocks?: ContentBlock[];
  seq?: number;
  /** When cancel was triggered with un-consumed steer messages still queued, server returns them joined here for the client to repopulate the input. */
  restoreDraft?: string;
}

/**
 * Emitted while a run's LLM request is in retry backoff (pre-first-token
 * failure: 429/529/5xx/network). Cleared client-side by any subsequent
 * stream event or terminal run event.
 */
export interface RunRetryingMessage {
  type: 'run_retrying';
  runId: string;
  sessionId: string;
  /** Upcoming attempt number (2..maxAttempts). */
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  /** HTTP status that triggered the retry; absent for connection-level failures. */
  status?: number;
  seq?: number;
}

export interface KillLeakedProcessesMessage {
  type: 'kill_leaked_processes';
}

export interface ProcessCleanupResultMessage {
  type: 'process_cleanup_result';
  status: 'clean' | 'killed' | 'skipped_active_runs';
  leakedCount: number;
  killedCount: number;
  activeRunCount: number;
}

// Agent Assistant messages

export interface AgentStartMessage {
  type: 'agent_start';
  clientRequestId: string;
  sessionId: string;
  input: string;
  llmProfileId?: string;
  tools?: string[];
}

export interface AgentCancelMessage {
  type: 'agent_cancel';
  sessionId: string;
}

export interface StopBackgroundTaskMessage {
  type: 'stop_background_task';
  sessionId: string;
  taskId: string;
  cliPid?: number;
  taskRootPid?: number;
  taskCommand?: string;
}

// Move a currently-running foreground Bash command into a background task
// (Client → Server). Without toolUseId, the session's oldest in-flight
// foreground command is converted.
export interface BackgroundRunningCommandMessage {
  type: 'background_running_command';
  sessionId: string;
  toolUseId?: string;
}

// Background task status update (Server → Client)
export type BackgroundTaskStatus = 'running' | 'paused' | 'completed' | 'failed';

export interface BackgroundTaskUpdateMessage {
  type: 'background_task_update';
  sessionId: string;
  parentSessionId?: string;
  status: BackgroundTaskStatus;
  name?: string;
  reason?: string; // e.g. 'Permission escalated', 'Completed successfully'
}

// Background session has a pending permission that needs user attention (Server → Client)
export interface BackgroundPermissionPendingMessage {
  type: 'background_permission_pending';
  sessionId: string; // The background session
  requestId: string; // Permission request ID (use with permission_decision to resolve)
  toolName: string;
  detail: string;
  timeoutSeconds: number;
}

// SDK task notification (e.g. background Bash process exited) (Server → Client)
export interface TaskNotificationMessage {
  type: 'task_notification';
  runId: string;
  sessionId: string;
  taskId?: string;
  status?: string;
  message?: string;
  seq?: number;
  cliPid?: number; // CLI subprocess PID (for process-tree based task killing)
  taskCommand?: string; // Actual command being run (e.g. "npm test")
  taskRootPid?: number; // Root PID of the task's process tree
}

// SDK background task progress update (Server → Client)
export interface TaskProgressMessage {
  type: 'task_progress';
  runId: string;
  sessionId: string;
  taskId: string;
  toolUseId?: string;
  description: string;
  usage: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
  };
  lastToolName?: string;
}

// SDK background task status notification (Server → Client)
export interface TaskStatusNotificationMessage {
  type: 'task_status_notification';
  runId: string;
  sessionId: string;
  taskId: string;
  toolUseId?: string;
  status: 'completed' | 'failed' | 'stopped';
  outputFile: string;
  summary: string;
  usage?: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
  };
}

export type RunClientMessage =
  | RunStartMessage
  | RunStartMessageV2
  | RunCancelMessage
  | RunSteerMessage
  | KillLeakedProcessesMessage
  | StopBackgroundTaskMessage
  | BackgroundRunningCommandMessage
  | AgentStartMessage
  | AgentCancelMessage;

export type RunServerMessage =
  | RunStartedMessage
  | InvocableCatalogChangedMessage
  | InvocationResultMessage
  | SessionCreatedMessage
  | DeltaMessage
  | ToolUseMessage
  | ToolResultMessage
  | ToolActivityMessage
  | ModeChangeMessage
  | RunCompletedMessage
  | RunFailedMessage
  | RunRetryingMessage
  | CompactionCompletedEvent
  | CompactionFailedEvent
  | MessageAppendedMessage
  | BackgroundTaskUpdateMessage
  | BackgroundPermissionPendingMessage
  | TaskNotificationMessage
  | TaskProgressMessage
  | TaskStatusNotificationMessage
  | ProcessCleanupResultMessage;

/**
 * Normalize a V2 run_start into the internal run start shape (URIP §15.2).
 *
 * - The message branch becomes the legacy string channel (attachments ride the
 *   existing `{ text, attachments }` envelope when present).
 * - The invocation branch returns the canonical `InvocationRequest` for the
 *   server-side router; mode and workingDirectory never accompany it.
 * - A V2 invocation may not carry mode or workingDirectory: the server rejects
 *   the combination instead of silently rebinding context.
 */
export type NormalizedRunStart =
  | { kind: 'message'; runStart: RunStartMessage }
  | { kind: 'invocation'; runStart: RunStartMessage; request: InvocationRequest };

export function normalizeRunStartV2(message: RunStartMessageV2): NormalizedRunStart {
  const { turnInput, protocolVersion, ...rest } = message;
  void protocolVersion;
  if (turnInput.type === 'invocation') {
    if (message.mode !== undefined || message.workingDirectory !== undefined) {
      throw new Error(
        'INVOCATION_CONTEXT_CHANGED: a selected invocation cannot override mode or working directory'
      );
    }
    return {
      kind: 'invocation',
      runStart: { ...rest, input: '' },
      request: turnInput.request,
    };
  }
  const hasAttachments = Array.isArray(turnInput.attachments) && turnInput.attachments.length > 0;
  return {
    kind: 'message',
    runStart: {
      ...rest,
      input: hasAttachments
        ? JSON.stringify({ text: turnInput.text, attachments: turnInput.attachments })
        : turnInput.text,
    },
  };
}

/**
 * Result of a server-resolved invocation (URIP design doc §12.4).
 *
 * Emitted when a submitted invocation (canonical selection or reserved
 * namespace typed as raw text) completes without a provider turn:
 * - `completed` / `text`: the server executed the body and the desktop renders
 *   the outcome into the transcript.
 * - `client-action`: the action body lives on the desktop; the server sends
 *   only the registered action ID plus typed payload — never instructions.
 */
export interface InvocationResultMessage {
  type: 'invocation_result';
  clientRequestId: string;
  sessionId: string;
  result:
    | { type: 'completed'; message?: string }
    | { type: 'text'; content: string }
    | { type: 'client-action'; actionId: string; payload?: Record<string, unknown> };
}
