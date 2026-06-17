import type { AgentTool } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';
import type { UnifiedPermissionPolicy } from '@zclaudia/shared/interaction/permissions';
import type { ToolName } from '@zclaudia/shared/core/tools';
import type { TaskExecutor } from '../../../domains/tasks/executors/types.js';
import type { PermissionCallback } from '../message-types.js';
import { createCommandDiagnosticsProvider, type CommandDiagnosticsOptions } from './command-diagnostics.js';
import { composeWriteLifecycleHooks, createFileChangeLifecycleHooks, type FileChangeNotifier } from './file-change-notifier.js';
import { createLspDiagnosticsAdapter, type LspTransport } from './lsp-diagnostics-adapter.js';
import { NoopEditGuard } from './noop-edit-guard.js';
import { createReadFileStateStore, type ReadFileStateStore } from './read-file-state.js';
import type { TaskRuntimeRegistryFactory } from './task-tools.js';
import type { ToolExecutionObserver } from './tool-execution-observer.js';
import type { DiagnosticsMode, WriteDiagnosticsProvider, WriteLifecycleHooks } from './write-lifecycle.js';

export interface ToolBridgeOptions {
  /** Subset of tools to enable. Default: all built-ins. */
  enabled?: string[];
  /** Replace specific pi tool implementations. Key is the tool name. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overrides?: Partial<Record<ToolName, AgentTool<any>>>;
  /** Optional runtime context for tools that bridge into ZClaudia services. */
  serverPort?: number;
  sessionId?: string;
  runId?: string;
  permissionOverride?: Partial<UnifiedPermissionPolicy>;
  db?: Database.Database;
  agentTaskExecutor?: TaskExecutor;
  /** Provider permission/interaction callback used by AskUserQuestion. */
  permissionCallback?: PermissionCallback;
  /** Whether the active model accepts image content blocks (model.input includes 'image'). */
  supportsVision?: boolean;
  /** Shared per-run read state used to require full reads before file mutations. */
  readFileState?: ReadFileStateStore;
  /** Optional write lifecycle hooks for diagnostics, IDE notifications, or file-history integrations. */
  writeLifecycle?: WriteLifecycleHooks;
  /** Optional adapter notified after successful file creates/modifications. */
  fileChangeNotifier?: FileChangeNotifier;
  /** Optional LSP diagnostics adapter backed by an injected transport. */
  lspDiagnosticsAdapter?: {
    transport: LspTransport;
    diagnosticsTimeoutMs?: number;
    languageIdForPath?: (filePath: string) => string;
  };
  /** Optional diagnostics adapter invoked after successful file writes. */
  diagnosticsProvider?: WriteDiagnosticsProvider;
  /** Optional command-backed diagnostics adapter invoked after successful file writes. */
  diagnosticsCommand?: CommandDiagnosticsOptions;
  /** Whether diagnostics run inline or are scheduled for deferred retrieval. */
  diagnosticsMode?: DiagnosticsMode;
  /** Plan mode read-only sandbox, set by the adapter — spec §6.
   * When true, Bash fails closed if the sandbox is unavailable. */
  sandboxReadOnly?: boolean;
  /** Phase B1: session-granted sandbox network domains, seeds the Bash escalation loop. */
  sandboxAllowedDomains?: string[];
  /** Foreground Bash auto-background threshold in ms (default 60s; 0 disables). */
  bashAutoBackgroundMs?: number;
  /** Shared per-run guard against repeated identical failed/no-op edits. */
  noopGuard?: NoopEditGuard;
  /** Per-project memory directory; absent = Memory tool disabled (e.g. sessions without a project, subagent tasks). */
  memoryDir?: string;
  /** Optional extension point for TaskOutput/Monitor runtimes. */
  taskRuntimeRegistryFactory?: TaskRuntimeRegistryFactory;
  /** Optional observer for application policies that react after tool execution. */
  toolExecutionObserver?: ToolExecutionObserver;
}

export function buildEffectiveToolOptions(cwd: string, options?: ToolBridgeOptions): ToolBridgeOptions {
  const lspAdapter = options?.lspDiagnosticsAdapter
    ? createLspDiagnosticsAdapter({ cwd, ...options.lspDiagnosticsAdapter })
    : undefined;
  const fileChangeLifecycle = createFileChangeLifecycleHooks(options?.fileChangeNotifier ?? lspAdapter?.fileChangeNotifier);
  return {
    ...options,
    readFileState: options?.readFileState ?? createReadFileStateStore(),
    noopGuard: options?.noopGuard ?? new NoopEditGuard(),
    writeLifecycle: composeWriteLifecycleHooks(options?.writeLifecycle, fileChangeLifecycle),
    diagnosticsProvider: options?.diagnosticsProvider
      ?? lspAdapter?.diagnosticsProvider
      ?? (options?.diagnosticsCommand ? createCommandDiagnosticsProvider(cwd, options.diagnosticsCommand) : undefined),
  };
}
