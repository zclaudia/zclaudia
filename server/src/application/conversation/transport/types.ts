import { type WebSocket } from 'ws';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ToolCall, ContentBlock, ThinkingBlock } from '@zclaudia/shared/core/message';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { PCPEffectiveProfile } from '@zclaudia/shared/core/pcp';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { AskUserQuestionItem } from '@zclaudia/shared/interaction/forms';
import type {
  PermissionDecision,
  SteerHandle,
  SystemInfo,
} from '../../../infra/providers/types.js';
import type {
  ExternalToolRuntimeState,
  SkillRuntimeState,
} from '../../../infra/providers/pi-runtime/index.js';
import type { initDatabase } from '../../../infra/storage/db.js';
import type { ProcessMonitor } from '../../../utils/process-monitor.js';
import type { NotificationSender } from '../../../infra/push/notification-sender.js';
import type { RunPhase, PhaseEmitter as PhaseEmitterType } from '../runtime/active-run-phase.js';

export interface ConnectedClient {
  id: string;
  ws: WebSocket;
  isAlive: boolean;
  isLocal: boolean; // Whether this is a localhost connection
  authenticated: boolean; // Whether the client has been authenticated
}

export interface PendingPermissionRequest {
  toolName: string;
  detail: string;
  matchedRule?: string;
  timeoutSeconds: number;
  sessionId?: string;
  requiresCredential?: boolean;
  credentialHint?: string;
  questions?: AskUserQuestionItem[];
}

export interface PendingPermission {
  resolve: (decision: PermissionDecision) => void;
  timeout: NodeJS.Timeout | null;
  originalToolInput?: unknown;
  // Original request info for state heartbeat reconstruction
  originalRequest?: PendingPermissionRequest;
}

export interface RunIdentityState {
  runId: string;
  sessionId: string;
  projectId: string;
  sessionType: 'regular' | 'background' | 'agent'; // Session type for this run
}

export interface RunConnectionState {
  clientId: string;
  client: ConnectedClient; // Direct reference (works for both real WS and virtual gateway clients)
}

export interface RunProviderState {
  abortController?: AbortController;
  providerType?: string; // Provider type for this run
  providerSessionId?: string; // Provider session ID (for abort support)
  providerCwd?: string; // Provider cwd (for abort support)
}

export interface RunPermissionState {
  pendingPermissions: Map<string, PendingPermission>;
  /** Session-scoped remembered permission decisions, hydrated into each run from DB.
   *  Key: toolName for non-bash, `Bash:<normalized-command>` for bash commands/subcommands. */
  rememberedDecisions: Map<string, 'allow' | 'deny'>;
  /** Project-scoped allowlist for paths outside workspace that the user explicitly remembered. */
  allowedOutsideWorkspaceRoots: Set<string>;
}

export interface RunPersistenceState {
  db: ReturnType<typeof initDatabase>;
  assistantMessageId: string;
}

export interface RunMessagingState {
  // Streaming state for message persistence (allows cancelRun to save partial content)
  fullContent: string;
  collectedToolCalls: (ToolCall & { toolUseId: string })[];
  contentBlocks: ContentBlock[];
  /**
   * Reasoning blocks accumulated from provider `thinking_delta` events.
   * Persisted to message metadata at upsert time so the UI can render
   * thinking cards alongside assistant content.
   */
  thinkingBlocks: ThinkingBlock[];
  saveInterval?: NodeJS.Timeout;
  eventSeq: number; // Monotonically increasing event sequence number (starts at 0, first event gets seq=1)
  /** Route C: set once the turn has been appended to the session tree (final save).
   *  Guards against the multiple final-save call sites duplicating tree entries. */
  treeTurnAppended?: boolean;
}

export interface RunLifecycleState {
  /**
   * Lifecycle phase. Hub-and-spoke state machine driven by `setPhase` /
   * `recomputePhase` (see active-run-phase.ts). Replaces the previous
   * `completed: boolean`. Heartbeat treats `isTerminalPhase(phase)` as
   * "hide while for-await drains".
   */
  phase: RunPhase;
  /** Observable phase changes; consumed by waitForIdle and future hooks. */
  phaseEmitter: PhaseEmitterType;
  /** True when AI called EnterPlanMode during a non-plan-mode run (not user-initiated). */
  aiInitiatedPlanMode?: boolean;
  /** Original mode before AI-initiated plan mode, used to restore after ExitPlanMode. */
  originalMode?: string;
}

export interface RunWorkspaceState {
  workspaceRoot: string;
}

export interface RunHealthState {
  // Stuck/loop detection
  startedAt: number;
  lastActivityAt: number;
  recentToolCalls: string[]; // Last N tool names (sliding window for loop detection)
  loopHeartbeatStreak: number; // Consecutive heartbeats that detect a loop pattern
  /** Number of SDK background tasks (run_in_background) still in flight.
   *  When > 0, the provider stream must stay open after `result` so that
   *  the follow-up assistant turn triggered by task completion is consumed. */
  pendingBackgroundTasks: number;
  latestSystemInfo?: SystemInfo; // Used for heartbeat reconciliation on late-joining clients
}

export interface RunProfileState {
  /** PCP effective profile negotiated at run start */
  effectiveProfile?: PCPEffectiveProfile;
  /**
   * Agent profile resolved at run start. Carries model + system prompt used by
   * compaction-service (combined with llmProfile.models to derive the effective
   * context window). Optional so legacy construction sites (heartbeat
   * reconstruction, supervision paths) keep compiling — populated eagerly by
   * `run-bootstrap`.
   */
  agentProfile?: AgentProfileConfig;
  /**
   * LLM provider profile (provider type + api key + base url) for compaction's
   * `generateSummary` calls. Populated alongside `agentProfile` in bootstrap.
   */
  llmProfile?: LlmProfileConfig;
}

export interface RunExtensionState {
  /** Session-scoped MCP/plugin tools progressively loaded during this run. */
  externalToolState?: ExternalToolRuntimeState;
  /** Session-scoped skills progressively loaded as active context. */
  skillState?: SkillRuntimeState;
}

export interface RunNotificationState {
  /**
   * Broadcast a message to ALL connected clients (not just the run's originating client).
   * Set up in run-bootstrap.ts. Falls back to run.client.ws if not wired (e.g. supervision).
   */
  broadcast?: (message: ServerMessage) => void;
}

export interface RunSteeringState {
  /**
   * Steer handle exposed by the provider adapter (registered via RunOptions.onAgentReady).
   * Present only when the underlying agent supports mid-run steering. Cleared on cancel.
   */
  steerHandle?: SteerHandle;
  /**
   * AgentMessages sent via run_steer but not yet drained by pi turn_start.
   * Cleared on turn_start (onSteerConsumed) or cancel.
   */
  pendingSteers: AgentMessage[];
  /**
   * Timestamp (ms) of the most recent steer persisted for this run. Used to
   * keep the derived steer message id (`steer-${runId}-${ts}`) unique even when
   * two steers land in the same millisecond, which would otherwise collide on
   * the messages PRIMARY KEY and drop the second steer from history.
   */
  lastSteerAt?: number;
}

// Track active runs and their permission callbacks.
// Keep this as a composition of smaller run facets so consumers can move toward
// narrow dependencies instead of accepting the whole runtime state bag.
export interface ActiveRun
  extends
    RunIdentityState,
    RunConnectionState,
    RunProviderState,
    RunPermissionState,
    RunPersistenceState,
    RunMessagingState,
    RunLifecycleState,
    RunWorkspaceState,
    RunHealthState,
    RunProfileState,
    RunExtensionState,
    RunNotificationState,
    RunSteeringState {}

// Message sender interface for abstraction
export interface MessageSender {
  send: (message: ServerMessage) => void;
}

// DEFAULT_PERMISSION_POLICY removed — use DEFAULT_UNIFIED_POLICY from '@zclaudia/shared' instead.
// PERMISSION_TIMEOUT_POLICIES removed — timeout logic is now handled by the permission workflow template.

export const MAX_SESSION_RESET_RETRIES = 1;
export const MAX_OVERFLOW_RETRIES = 1;

export const PERIODIC_SAVE_INTERVAL_MS = 5000;

// Create a virtual client for Gateway-forwarded messages
export function createVirtualClient(clientId: string, sender: MessageSender): ConnectedClient {
  return {
    id: clientId,
    ws: {
      readyState: 1, // WebSocket.OPEN
      send: (data: string) => {
        const message = JSON.parse(data);
        sender.send(message);
      },
    } as WebSocket,
    isAlive: true,
    isLocal: false,
    authenticated: true,
  };
}
