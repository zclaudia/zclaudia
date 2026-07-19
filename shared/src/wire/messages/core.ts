/**
 * Core protocol messages: authentication, ping/pong, errors, system info, and state heartbeat.
 */

import type { ServerFeature } from '../../core/server.js';
import type { SessionType } from '../../core/session.js';
import type { NotificationUnreadCountsByTab } from '../../features/notification-feed.js';
import type { AskUserQuestionItem } from '../../interaction/forms.js';

// Authentication message (sent after WebSocket connection)
export interface AuthMessage {
  type: 'auth';
}

export interface PingMessage {
  type: 'ping';
}

export interface PongMessage {
  type: 'pong';
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

// Authentication result message
export interface AuthResultMessage {
  type: 'auth_result';
  success: boolean;
  error?: string;
  isLocalConnection?: boolean; // Whether the connection is from localhost
  serverVersion?: string; // Server version string
  features?: ServerFeature[]; // Server-advertised feature flags
  /** PEM-encoded RSA-OAEP public key for E2E credential encryption */
  publicKey?: string;
}

// Run health status for stuck/loop detection
export type RunHealthStatus = 'healthy' | 'idle' | 'loop';

/**
 * Which layer in the resolution chain supplied the effective context window.
 * Lets the UI explain "why" — and warn when we hit the last-resort fallback.
 *
 * - `profile_entry`         — user-declared `llm_profile.models[*].contextWindow`.
 * - `pi_ai_registry`        — pi-ai's model registry. May come from the
 *                             same-provider lookup (e.g. providerType=openai
 *                             + modelId="gpt-5") or a cross-provider sweep
 *                             when the user runs a registered model id
 *                             through an OpenAI-compatible proxy. The
 *                             matched pi-ai provider is reported in
 *                             {@link SystemInfo.contextWindowMatchedProvider}.
 * - `openai_compat_default` — fallback 128k literal that the openai-compat
 *                             code path assumes when no registry entry
 *                             matches. Distinguishing this from `fallback`
 *                             lets the UI explain "we assumed the standard
 *                             openai-compat window because nothing else
 *                             matched" without misleadingly claiming a
 *                             registry hit.
 * - `fallback`              — last-resort 100k safety net; signals "we don't
 *                             actually know" so UI can show a warning.
 */
export type ContextWindowSource =
  | 'profile_entry'
  | 'pi_ai_registry'
  | 'openai_compat_default'
  | 'fallback';

// Provider system info from runtime init message
export interface SystemInfo {
  model?: string;
  /** Effective context window in tokens, resolved from agent profile / LLM
   *  profile / pi-ai registry. UI uses this for the X/Y display. */
  contextWindow?: number;
  /** Provenance of {@link SystemInfo.contextWindow}. Set whenever
   *  contextWindow is — UI uses this to surface "from your LLM profile" vs
   *  "fallback estimate" and to warn on the fallback path. */
  contextWindowSource?: ContextWindowSource;
  /** When `contextWindowSource === 'pi_ai_registry'`, the pi-ai provider id
   *  whose registry entry was matched. Same-provider hits set this to the
   *  configured providerType (e.g. `anthropic`); cross-provider hits set it
   *  to whichever provider supplied the matching model id (e.g. running
   *  `deepseek-v4` through an openai-compat proxy resolves to `deepseek`).
   *  Lets the UI show "from registry (deepseek)" instead of just "registry". */
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

export interface SystemInfoMessage {
  type: 'system_info';
  runId: string;
  systemInfo: SystemInfo;
  seq?: number;
}

// Server → Client: state heartbeat for reconciliation
export interface StateHeartbeatMessage {
  type: 'state_heartbeat';
  activeRuns: Array<{
    runId: string;
    sessionId: string;
    /** Persisted assistant row for exact reconnect/finalization targeting. */
    assistantMessageId?: string;
    startedAt: number;
    lastActivityAt: number;
    health: RunHealthStatus;
    loopPattern?: string;
    /** Session type — background runs should not affect the session's loading state */
    sessionType?: SessionType;
    /** Latest init/system metadata for this run (if available). */
    systemInfo?: SystemInfo;
    /** Last event sequence number for this run (for gap detection). */
    lastSeq?: number;
  }>;
  pendingPermissions: Array<{
    requestId: string;
    sessionId: string;
    toolName: string;
    detail: string;
    matchedRule?: string;
    timeoutSeconds: number;
    requiresCredential?: boolean;
    credentialHint?: string;
    aiInitiated?: boolean;
  }>;
  pendingQuestions: Array<{
    requestId: string;
    sessionId: string;
    questions: AskUserQuestionItem[];
  }>;
  /** Unread Agent Feed item count — for badge display on reconnect */
  unreadFeedCount?: number;
  /** Unread Agent Feed item count by tab — for notch and inbox badges on reconnect */
  unreadFeedCountsByTab?: NotificationUnreadCountsByTab;
  /** Version counters for stable application-layer entities.
   *  Client compares with its local cache and fetches via REST if stale. */
  versions?: {
    projects?: number;
    plugins?: number;
  };
}

export type CoreClientMessage = AuthMessage | PingMessage;

export type CoreServerMessage =
  | AuthResultMessage
  | PongMessage
  | ErrorMessage
  | SystemInfoMessage
  | StateHeartbeatMessage;
