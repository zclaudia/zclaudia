import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolName } from '@zclaudia/shared/core/tools';
import { createAgentTool, createMonitorTool, createTaskOutputTool } from './task-tools.js';
import { createAskUserQuestionTool, createTodoWriteTool } from './interaction-tools.js';
import { createAstEditTool, createAstGrepTool } from './ast-bridge-tools.js';
import { createBashBridgeTool } from './bash-tool.js';
import { createEditBridgeTool as createFileEditBridgeTool, createWriteBridgeTool as createFileWriteBridgeTool } from './edit-write-tools.js';
import { createEnterPlanModeTool, createExitPlanModeTool } from './mode-tools.js';
import { createEnterWorktreeTool, createExitWorktreeTool } from './worktree-tools.js';
import { createEvalBridgeTool } from './eval-tool.js';
import { createGlobTool, createGrepBridgeTool, createLsBridgeTool, createLspTool } from './search-tools.js';
import { createListMcpResourcesTool, createMcpTool, createReadMcpResourceTool, createToolSearchTool } from './mcp-bridge-tools.js';
import { createMemoryTool } from './memory-tool.js';
import { createReadBridgeTool } from './read-tool.js';
import { createWebFetchTool, createWebSearchTool } from './web-tools.js';
import type { ToolBridgeOptions } from './tool-options.js';

export type ToolFactory = (cwd: string, options?: ToolBridgeOptions) => AgentTool<any>;

// Dispatch table: tool name → factory taking (cwd, options?) and returning an AgentTool.
// Each pi factory accepts an optional per-tool options object; we don't expose those
// in this MVP (use pi defaults). Future sub-projects can wire ToolBridgeOptions.<name>
// through to the factory.
export const BUILTIN_TOOL_FACTORIES: Record<ToolName, ToolFactory> = {
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
