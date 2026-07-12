// shared/src/providers/external-agent.ts
import type { ThinkingLevel } from '../core/agent-profile.js';
import type { ProviderRuntimeEvent } from './runtime-events.js';
import type { PermissionCallback } from './permissions.js';

/** An MCP server entry the host injects so the external agent can reach zclaudia's plugin tools. */
export interface ProviderToolBridgeEntry {
  /** MCP server name the adapter should register the entry under. */
  name: string;
  /** Opaque MCP server config (shape defined by the agent's own SDK). */
  config: unknown;
}

export interface ProviderToolBridgeRequest {
  serverPort?: number;
  sessionId?: string;
}

/** Minimal, stable run context handed to an external-agent adapter. */
export interface ExternalAgentRunContext {
  cwd: string;
  sessionId?: string;
  env?: Record<string, string>;
  /** User-selected mode id; adapter maps it to its own permission mode. */
  mode?: string;
  systemPrompt?: string;
  sessionTitle?: string;
  /** Main server port, for the plugin tool bridge. */
  serverPort?: number;
  /** ZClaudia session id, for interaction/tool-bridge context. */
  claudiaSessionId?: string;
  thinkingLevel?: ThinkingLevel;
  /** Resolved model id for this run (from the agent profile). */
  model?: string;
  /** Runtime executable override (from the agent profile). */
  cliPath?: string;
  /** Shared abort controller owned by the host runtime. */
  abortController?: AbortController;
}

/** Per-session provider state stored on the host's ActiveRun. */
export interface ExternalAgentRunState {
  providerSessionId?: string;
  providerCwd: string;
}

/** The contract a plugin implements to contribute an external agent runtime. */
export interface ExternalAgentAdapter {
  readonly type: string;
  run(
    input: string,
    context: ExternalAgentRunContext,
    onPermission: PermissionCallback
  ): AsyncGenerator<ProviderRuntimeEvent, void, void>;
  abort?(sessionId: string, cwd: string): Promise<void>;
  getRunState?(context: ExternalAgentRunContext): ExternalAgentRunState;
  setSessionMode?(sessionId: string, mode: string): void;
}
