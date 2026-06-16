import type { AgentTool } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';
import type { UnifiedPermissionPolicy } from '@zclaudia/shared/interaction/permissions';

import { ALL_TOOL_NAMES, normalizeToolName, type ToolName } from '@zclaudia/shared/core/tools';
import { createReadFileStateStore, type ReadFileStateStore } from './read-file-state.js';
import { createEditBridgeTool as createFileEditBridgeTool, createWriteBridgeTool as createFileWriteBridgeTool } from './edit-write-tools.js';
import type { DiagnosticsMode, WriteDiagnosticsProvider, WriteLifecycleHooks } from './write-lifecycle.js';
import { createCommandDiagnosticsProvider, type CommandDiagnosticsOptions } from './command-diagnostics.js';
import { composeWriteLifecycleHooks, createFileChangeLifecycleHooks, type FileChangeNotifier } from './file-change-notifier.js';
import { createLspDiagnosticsAdapter, type LspTransport } from './lsp-diagnostics-adapter.js';
import { NoopEditGuard } from './noop-edit-guard.js';
import type { TaskExecutor } from '../../../domains/tasks/executors/types.js';
import { activateConditionalSkillsForPaths, activateConditionalSkillsForToolNames } from '../../../application/plugins/skill-tools.js';
import type { PermissionCallback } from '../types.js';
import { createAskUserQuestionTool, createTodoWriteTool } from './interaction-tools.js';
import { createWebFetchTool, createWebSearchTool } from './web-tools.js';
import {
  createListMcpResourcesTool,
  createMcpTool,
  createReadMcpResourceTool,
  createToolSearchTool,
} from './mcp-bridge-tools.js';
import { createGlobTool, createGrepBridgeTool, createLsBridgeTool, createLspTool } from './search-tools.js';
import { createReadBridgeTool } from './read-tool.js';
import { createAstEditTool, createAstGrepTool } from './ast-bridge-tools.js';
import { createEvalBridgeTool } from './eval-tool.js';
import { createEnterPlanModeTool, createExitPlanModeTool } from './mode-tools.js';
import { createEnterWorktreeTool, createExitWorktreeTool } from './worktree-tools.js';
import { createAgentTool, createMonitorTool, createTaskOutputTool, type TaskRuntimeRegistryFactory } from './task-tools.js';
import { createBashBridgeTool } from './bash-tool.js';
import { createMemoryTool } from './memory-tool.js';
export { ALL_TOOL_NAMES, type ToolName };

function toolParams(first: unknown, second: unknown): Record<string, unknown> {
  const candidate = second ?? first;
  return candidate && typeof candidate === 'object'
    ? candidate as Record<string, unknown>
    : {};
}

function extractSkillActivationPaths(toolName: ToolName, params: Record<string, unknown>): string[] {
  const value = (() => {
    if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') return params.path ?? params.file_path;
    if (toolName === 'Grep' || toolName === 'Glob' || toolName === 'LS') return params.path;
    return undefined;
  })();
  return typeof value === 'string' && value.trim() ? [value.trim()] : [];
}

function withConditionalSkillActivation(tool: AgentTool<any>, name: ToolName, cwd: string): AgentTool<any> {
  const originalExecute = tool.execute;
  if (!originalExecute) return tool;
  return {
    ...tool,
    execute: async (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: any) => {
      const result = await originalExecute(toolCallId, params, signal, onUpdate);
      const paths = extractSkillActivationPaths(name, toolParams(toolCallId, params));
      if (paths.length > 0) activateConditionalSkillsForPaths(paths, cwd);
      activateConditionalSkillsForToolNames([name]);
      return result;
    },
  } as AgentTool<any>;
}

function withToolName(tool: AgentTool<any>, name: ToolName, label: string = name): AgentTool<any> {
  return { ...tool, name, label } as AgentTool<any>;
}

// Dispatch table: tool name → factory taking (cwd, options?) and returning an AgentTool.
// Each pi factory accepts an optional per-tool options object; we don't expose those
// in this MVP (use pi defaults). Future sub-projects can wire ToolBridgeOptions.<name>
// through to the factory.
const TOOL_FACTORIES: Record<ToolName, (cwd: string, options?: ToolBridgeOptions) => AgentTool<any>> = {
  Read: (cwd, options) => createReadBridgeTool(cwd, options),
  Write: (cwd, options) => createFileWriteBridgeTool(cwd, options),
  Edit: (cwd, options) => createFileEditBridgeTool(cwd, options),
  Bash: (cwd, options) => createBashBridgeTool(cwd, options),
  Eval: (cwd, options) => createEvalBridgeTool(cwd, options),
  Grep: (cwd) => createGrepBridgeTool(cwd),
  Glob: (cwd) => createGlobTool(cwd),
  LS: (cwd) => createLsBridgeTool(cwd),
  TodoWrite: () => createTodoWriteTool(),
  AskUserQuestion: (_cwd, options) => createAskUserQuestionTool(options?.permissionCallback),
  WebFetch: () => createWebFetchTool(),
  WebSearch: () => createWebSearchTool(),
  MCPTool: (_cwd, options) => createMcpTool(options?.db),
  ToolSearch: (_cwd, options) => createToolSearchTool(options?.db),
  ListMcpResources: (_cwd, options) => createListMcpResourcesTool(options?.db),
  ReadMcpResource: (_cwd, options) => createReadMcpResourceTool(options?.db),
  TaskOutput: (_cwd, options) => createTaskOutputTool(options?.db, options?.taskRuntimeRegistryFactory),
  Monitor: (_cwd, options) => createMonitorTool(options?.sessionId, options?.runId, options?.db, options?.taskRuntimeRegistryFactory),
  Agent: (cwd, options) => createAgentTool(
    cwd,
    options?.sessionId,
    options?.runId,
    options?.db,
    options?.permissionOverride,
    options?.agentTaskExecutor,
  ),
  LSPTool: (cwd) => createLspTool(cwd),
  AstGrep: (cwd) => createAstGrepTool(cwd),
  AstEdit: (cwd, options) => createAstEditTool(cwd, options),
  EnterWorktree: (cwd, options) => createEnterWorktreeTool(cwd, options),
  ExitWorktree: (cwd, options) => createExitWorktreeTool(cwd, options),
  EnterPlanMode: (cwd, options) => createEnterPlanModeTool(cwd, options),
  ExitPlanMode: (cwd, options) => createExitPlanModeTool(cwd, options),
  // The buildTools loop skips Memory when memoryDir is absent, so the
  // assertions are safe at this callsite; createMemoryTool also fail-fasts.
  Memory: (_cwd, options) => createMemoryTool({ memoryDir: options!.memoryDir! }),
};

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
}

/**
 * Build the AgentTool[] passed to pi `Agent`'s initialState.tools.
 *
 * `cwd` is required by pi tools to enforce a working-directory boundary
 * (e.g. read can't open files outside cwd).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildTools(cwd: string, options?: ToolBridgeOptions): AgentTool<any>[] {
  const lspAdapter = options?.lspDiagnosticsAdapter
    ? createLspDiagnosticsAdapter({ cwd, ...options.lspDiagnosticsAdapter })
    : undefined;
  const fileChangeLifecycle = createFileChangeLifecycleHooks(options?.fileChangeNotifier ?? lspAdapter?.fileChangeNotifier);
  const effectiveOptions: ToolBridgeOptions = {
    ...options,
    readFileState: options?.readFileState ?? createReadFileStateStore(),
    noopGuard: options?.noopGuard ?? new NoopEditGuard(),
    writeLifecycle: composeWriteLifecycleHooks(options?.writeLifecycle, fileChangeLifecycle),
    diagnosticsProvider: options?.diagnosticsProvider
      ?? lspAdapter?.diagnosticsProvider
      ?? (options?.diagnosticsCommand ? createCommandDiagnosticsProvider(cwd, options.diagnosticsCommand) : undefined),
  };
  const requested = options?.enabled ?? [...ALL_TOOL_NAMES];
  const overrides = new Map<ToolName, AgentTool<any>>();
  for (const [overrideName, tool] of Object.entries(effectiveOptions.overrides ?? {})) {
    const normalized = normalizeToolName(overrideName);
    if (normalized && tool) overrides.set(normalized, tool);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: AgentTool<any>[] = [];

  for (const requestedName of requested) {
    const name = normalizeToolName(requestedName);
    if (!name) {
      console.warn(`[buildTools] Unknown tool name skipped: ${requestedName}`);
      continue;
    }
    if (name === 'Memory' && !effectiveOptions.memoryDir) continue;
    const override = overrides.get(name);
    if (override) {
      result.push(withConditionalSkillActivation(withToolName(override, name, override.label ?? name), name, cwd));
    } else {
      result.push(withConditionalSkillActivation(TOOL_FACTORIES[name](cwd, effectiveOptions), name, cwd));
    }
  }

  return result;
}
