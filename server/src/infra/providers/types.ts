import type { PCPProviderManifest } from '@zclaudia/shared/core/pcp';
import type { ProviderPolicy } from '@zclaudia/shared/core/provider-policy';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { AgentProfileConfig, ThinkingLevel } from '@zclaudia/shared/core/agent-profile';
import type { ToolName } from '@zclaudia/shared/core/tools';
import type Database from 'better-sqlite3';
import type { ProviderEventNormalizer } from './provider-normalizer.js';
import type { ClaudeMessage, PermissionCallback } from './message-types.js';

// Re-export core provider message types (shared across all providers)
export type { ClaudeMessage, SystemInfo, PermissionDecision, PermissionCallback } from './message-types.js';

/** Options for starting a zclaudia agent runtime run. */
export interface RunOptions {
  cwd: string;
  sessionId?: string;
  cliPath?: string;
  env?: Record<string, string>;
  mode?: string;
  model?: string;
  systemPrompt?: string;  // Full system prompt sourced from agentProfile.systemPrompt by run-context (§4.6 full replacement)
  sessionTitle?: string;  // Optional session title for providers that support it
  serverPort?: number;    // Main server port for MCP bridge
  claudiaSessionId?: string;  // ZClaudia session ID (for interaction tool context)
  db?: Database.Database;  // Database for loading ZClaudia-managed MCP servers
  /** Resolved LLM profile to drive buildModel. If undefined, buildModel falls back to env. */
  llmProfileConfig?: LlmProfileConfig;
  /** Full agent profile resolved by run-bootstrap (for tracing / future). */
  agentProfile?: AgentProfileConfig;
  /** Subset of pi tools to enable (derived from agent.enabledTools). */
  enabledTools?: ToolName[];
  /** Pi thinking budget; undefined = pi default. */
  thinkingLevel?: ThinkingLevel;
}

/** Agent runtime adapter interface. */
export interface ProviderAdapter {
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
    onPermission: PermissionCallback,
  ): AsyncGenerator<ClaudeMessage, void, void>;

  /** Abort an active session */
  abort?(sessionId: string, cwd: string): Promise<void>;

  /** Stop a specific background task. Returns true if processes were actually killed. */
  stopTask?(sessionId: string, taskId: string): Promise<boolean | void>;

  /** Get CLI subprocess PID for a session (if available) */
  getCliPid?(sessionId: string): number | undefined;

  /** Get resolved process info for a specific background task */
  getTaskProcessInfo?(taskId: string): { taskId: string; command?: string; rootPid?: number; pids: number[] } | undefined;

  /** Get provider-specific state to store on ActiveRun */
  getRunState?(options: RunOptions): Record<string, unknown>;

  /** Dynamically switch the session's mode (e.g. when AI calls EnterPlanMode/ExitPlanMode) */
  setSessionMode?(sessionId: string, mode: string): void;
}
