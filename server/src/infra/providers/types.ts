import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { PCPProviderManifest } from '@zclaudia/shared/core/pcp';
import type { ProviderPolicy } from '@zclaudia/shared/core/provider-policy';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { AgentProfileConfig, ThinkingLevel } from '@zclaudia/shared/core/agent-profile';
import type { ToolName } from '@zclaudia/shared/core/tools';
import type Database from 'better-sqlite3';
import type { ProviderEventNormalizer } from './provider-normalizer.js';
import type { PermissionCallback, ProviderRuntimeEvent } from './message-types.js';
import type { TaskExecutor } from '../../domains/tasks/executors/types.js';
import type {
  ExternalToolRuntimeState,
  SkillRuntimeState,
  ToolExecutionObserver,
} from './pi-runtime/index.js';

/** Handle exposed to the application after pi Agent construction, for mid-run steering. */
export interface SteerHandle {
  /** Push a user AgentMessage into the live pi Agent's steering queue. */
  steer: (message: AgentMessage) => void;
}

// Re-export core provider message types (shared across all providers)
export type {
  PermissionCallback,
  PermissionDecision,
  ProviderRuntimeEvent,
  SystemInfo,
} from './message-types.js';

/** Options for starting an agent runtime run. */
export interface RunOptions {
  cwd: string;
  sessionId?: string;
  /**
   * Persisted transport of the provider session being resumed
   * (e.g. `cursor-acp-v1` / `cursor-stream-json-v1`). Null for new sessions;
   * resumes must honor the binding instead of guessing (Cursor ACP §14).
   */
  providerTransport?: string | null;
  cliPath?: string;
  env?: Record<string, string>;
  /** User-selected mode id (matches one of `ProviderCapabilities.modes`).
   *  Adapter derives PCP `permissionMode` from this. */
  mode?: string;
  /** Native agents receive only explicit profile instructions; Pi also receives host context. */
  systemPrompt?: string;
  sessionTitle?: string; // Optional session title for providers that support it
  serverPort?: number; // Main server port for MCP bridge
  claudiaSessionId?: string; // ZClaudia session ID (for interaction tool context)
  runId?: string; // ZClaudia run ID for delegated task provenance
  permissionOverride?: Partial<
    import('@zclaudia/shared/interaction/permissions').UnifiedPermissionPolicy
  >;
  db?: Database.Database; // Database for loading ZClaudia-managed MCP servers
  agentTaskExecutor?: TaskExecutor;
  /** Resolved LLM profile to drive buildModel. If undefined, buildModel falls back to env. */
  llmProfileConfig?: LlmProfileConfig;
  /** Full agent profile resolved by run-bootstrap (for tracing / future). */
  agentProfile?: AgentProfileConfig;
  /** Subset of pi tools to enable (derived from agent.enabledTools). */
  enabledTools?: ToolName[];
  /** Session-scoped progressive external tool state. */
  externalToolState?: ExternalToolRuntimeState;
  /** Session-scoped progressive skill context state. */
  skillState?: SkillRuntimeState;
  /** Pi thinking budget; undefined = pi default. */
  thinkingLevel?: ThinkingLevel;
  /** Called once synchronously after the pi Agent is instantiated. Application registers handle for mid-run steer. */
  onAgentReady?: (handle: SteerHandle) => void;
  /** Called when pi emits `turn_start` (after the steering queue is drained with steeringMode:'all'). Application clears pendingSteers. */
  onSteerConsumed?: () => void;
  /** Shared run abort controller owned by the application runtime. */
  abortController?: AbortController;
  /** Resolved image attachments for this prompt (base64, ≤5MB each). */
  images?: Array<{ name: string; mimeType: string; data: string }>;
  /** Resolved user hooks for PreToolUse / PostToolUse lifecycle. */
  userHooks?: import('@zclaudia/shared/interaction/user-hooks').UserHookDefinition[];
  /** Per-project memory directory (absent = memory feature disabled for this run). */
  memoryDir?: string;
  /** Application policy hook invoked by pi-runtime after a built-in tool succeeds. */
  toolExecutionObserver?: ToolExecutionObserver;
  /** Engine-mode execution identity for dual-mode runtimes (absent for legacy single-mode runs). */
  engineExecution?: import('@zclaudia/shared/providers').EngineExecutionContext;
  /** Explicit model connection for SDK engine modes; in-memory for this run only. */
  modelConnection?: import('@zclaudia/shared/providers').RuntimeModelConnection;
  /** Ledger invocation this dispatch is accounted under (runtime usage design §6). */
  usageAccounting?: { invocationId: string };
  /**
   * Trusted cumulative usage checkpoint for resumed native threads (Codex
   * design §5.2), read from the ledger before dispatch. `null` means the
   * host looked and found none — the plugin must treat the baseline as
   * unknown, never as zero. The plugin proves same-thread identity (its own
   * threadId vs `nativeThreadId`) before trusting the counters.
   */
  usageBaseline?: {
    cumulative: import('@zclaudia/shared/core/runtime-usage').CodexTokenUsageCounters;
    nativeThreadId?: string;
  } | null;
}

/** Outcome of `ProviderAdapter.requestBackgroundForToolCall`. */
export type BackgroundConversionResult =
  | { ok: true; command: string }
  | { ok: false; reason: string };

/** Agent runtime adapter interface. */
export interface ProviderAdapter {
  discoverModels?: (
    context: import('@zclaudia/shared/providers').ExternalAgentRunContext,
    signal: AbortSignal
  ) => Promise<import('@zclaudia/shared/core/runtime-capabilities').RuntimeModelCatalog>;
  readonly type: string;

  /** PCP manifest — static capability declaration */
  readonly manifest?: PCPProviderManifest;

  /** ZClaudia runtime policy for provider-specific behavior */
  readonly policy?: ProviderPolicy;

  /** Provider-native event/tool normalization rules */
  readonly normalizer?: ProviderEventNormalizer;

  /** Start a run, returns async generator of messages */
  run(
    input: string,
    options: RunOptions,
    onPermission: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void>;

  /**
   * URIP V2 turn entry (design doc §9/§15): receives the typed turn input —
   * message, runtime invocation, or portable skill — for adapters that opted
   * in. When absent, only legacy string runs are possible and typed
   * invocations fail with INVOCATION_UNSUPPORTED before any provider turn.
   */
  startTurn?(
    input: import('@zclaudia/shared/providers').RuntimeTurnInput,
    options: RunOptions,
    onPermission: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void>;

  /** URIP runtime catalog source owned by the active adapter (§9.1). */
  invocations?: import('@zclaudia/shared/providers').RuntimeInvocationProvider;

  /** Abort an active session */
  abort?(sessionId: string, cwd: string): Promise<void>;

  /** Stop a specific background task. Returns true if processes were actually killed. */
  stopTask?(sessionId: string, taskId: string): Promise<boolean | void>;

  /**
   * Move a running foreground tool call into a background task ("free the
   * session"). Only adapters that own the executing process implement this,
   * and only for calls they announced with `toolBackgroundable`. Without
   * toolUseId the session's oldest in-flight command is converted. The tool
   * call then resolves through the adapter's normal event flow.
   */
  requestBackgroundForToolCall?(sessionId: string, toolUseId?: string): BackgroundConversionResult;

  /** Get CLI subprocess PID for a session (if available) */
  getCliPid?(sessionId: string): number | undefined;

  /** Get resolved process info for a specific background task */
  getTaskProcessInfo?(
    taskId: string
  ): { taskId: string; command?: string; rootPid?: number; pids: number[] } | undefined;

  /** Get provider-specific state to store on ActiveRun */
  getRunState?(options: RunOptions): Record<string, unknown>;

  /** Dynamically switch the session's mode (e.g. when AI calls EnterPlanMode/ExitPlanMode) */
  setSessionMode?(sessionId: string, mode: string): void;
}
