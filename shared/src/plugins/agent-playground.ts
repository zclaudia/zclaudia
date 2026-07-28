import type {
  AgentRuntimeDescriptor,
  PermissionDecision,
  PermissionRequest,
  ProviderRuntimeEvent,
} from '../providers/index.js';
import type { ThinkingLevel } from '../core/agent-profile.js';

export type AgentPlaygroundPermissionPolicy = 'prompt' | 'allow' | 'deny';
export type AgentPlaygroundLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AgentPlaygroundPluginInfo {
  id: string;
  name: string;
  version: string;
  path: string;
}

export interface AgentPlaygroundStatus {
  ready: boolean;
  plugin: AgentPlaygroundPluginInfo;
  runtime: AgentRuntimeDescriptor;
  defaultCwd: string;
  activeRunIds: string[];
  toolBridgeAvailable: boolean;
}

export interface AgentPlaygroundRunRequest {
  input: string;
  cwd: string;
  sessionId?: string;
  cliPath?: string;
  mode?: string;
  systemPrompt?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  permissionPolicy?: AgentPlaygroundPermissionPolicy;
}

export interface AgentPlaygroundRunAccepted {
  runId: string;
}

export interface AgentPlaygroundPermissionDecisionRequest extends PermissionDecision {
  requestId: string;
}

interface AgentPlaygroundMessageMetadata {
  timestamp: number;
  /**
   * Monotonic within one Dev Host process. Clients use it to discard replayed
   * WebSocket messages after reconnecting.
   */
  sequence?: number;
}

type AgentPlaygroundMessage<T> = T & AgentPlaygroundMessageMetadata;

export type AgentPlaygroundServerMessage =
  | AgentPlaygroundMessage<{
      type: 'status';
      status: AgentPlaygroundStatus;
    }>
  | AgentPlaygroundMessage<{
      type: 'run_started';
      runId: string;
      request: AgentPlaygroundRunRequest;
    }>
  | AgentPlaygroundMessage<{
      type: 'runtime_event';
      runId: string;
      event: ProviderRuntimeEvent;
    }>
  | AgentPlaygroundMessage<{
      type: 'permission_request';
      runId: string;
      request: PermissionRequest;
    }>
  | AgentPlaygroundMessage<{
      type: 'permission_resolved';
      runId: string;
      requestId: string;
      decision: PermissionDecision;
    }>
  | AgentPlaygroundMessage<{
      type: 'run_finished';
      runId: string;
      sessionId?: string;
      aborted: boolean;
    }>
  | AgentPlaygroundMessage<{
      type: 'run_failed';
      runId: string;
      error: string;
      aborted: boolean;
    }>
  | AgentPlaygroundMessage<{
      type: 'plugin_log';
      level: AgentPlaygroundLogLevel;
      message: string;
    }>
  | AgentPlaygroundMessage<{
      type: 'plugin_reloaded';
      status: AgentPlaygroundStatus;
    }>;
