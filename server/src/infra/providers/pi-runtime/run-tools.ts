import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolName } from '@zclaudia/shared/core/tools';
import type { PermissionCallback, RunOptions } from '../types.js';
import { loadSessionSandboxDomains } from '../../../application/conversation/agent/permission-memory.js';
import { buildAgentHooks } from './agent-hooks.js';
import { PendingArgOverrides } from './pending-arg-overrides.js';
import {
  buildExternalMetaTools,
  buildExternalProviderCatalog,
  concreteMcpToolName,
  createConcreteMcpTool,
  externalToolKey,
} from './external-tools.js';
import { buildActiveSkillContext, buildSkillCatalog, buildSkillMetaTools } from './skills.js';
import { buildTools } from './tool-bridge.js';

export interface PiRunToolBundle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: AgentTool<any>[];
  visibleToolNames: string[];
  externalProviderCatalog: string;
  skillCatalog: string;
  activeSkillContext: string;
  hooks: ReturnType<typeof buildAgentHooks>;
}

/**
 * Meta tools that load new callable capabilities into the live tools array
 * mid-run. They are excluded in plan mode because the concrete tools they add
 * (e.g. MCP tools) are not part of the read-only plan-mode tool set.
 */
const PLAN_MODE_BLOCKED_META_TOOLS = new Set(['LoadExternalTool']);

export function buildPiRunToolBundle(input: {
  options: RunOptions;
  effectiveTools: ToolName[];
  supportsVision: boolean;
  isPlanMode: boolean;
  permissionCallback?: PermissionCallback;
}): PiRunToolBundle {
  const { options, effectiveTools, supportsVision, isPlanMode, permissionCallback } = input;
  // One store per run: carries permission-approved updatedInput rewrites from
  // the beforeToolCall hook into the wrapped tool executes (pi drops `{ args }`).
  const argOverrides = new PendingArgOverrides();
  const sandboxAllowedDomains =
    options.db && options.claudiaSessionId
      ? loadSessionSandboxDomains(options.db, options.claudiaSessionId)
      : [];
  const tools = buildTools(options.cwd, {
    enabled: effectiveTools,
    supportsVision,
    serverPort: options.serverPort,
    sessionId: options.claudiaSessionId,
    runId: options.runId,
    permissionOverride: options.permissionOverride,
    db: options.db,
    agentTaskExecutor: options.agentTaskExecutor,
    permissionCallback,
    sandboxReadOnly: isPlanMode,
    sandboxAllowedDomains,
    memoryDir: options.memoryDir,
    toolExecutionObserver: options.toolExecutionObserver,
    argOverrides,
  });
  if (options.externalToolState) {
    // Security (P0-6): plan mode is read-only, so concrete external/MCP tools
    // (pinned or dynamically loaded) must not be callable, and the meta tool
    // that appends them to the live tools array (LoadExternalTool) is excluded
    // too. Read-only discovery meta tools (list/search/inspect/read) remain.
    if (!isPlanMode) {
      for (const ref of options.externalToolState.loadedExternalTools) {
        if (ref.source === 'mcp') {
          tools.push(
            createConcreteMcpTool(
              ref,
              options.db,
              options.externalToolState.loadedExternalToolSchemas?.[externalToolKey(ref)]
            )
          );
        }
      }
    }
    const externalMetaTools = buildExternalMetaTools({
      db: options.db,
      state: options.externalToolState,
      toolsArray: tools,
    });
    tools.push(
      ...(isPlanMode
        ? externalMetaTools.filter(tool => !PLAN_MODE_BLOCKED_META_TOOLS.has(tool.name))
        : externalMetaTools)
    );
  }
  if (options.skillState) {
    tools.push(
      ...buildSkillMetaTools({
        state: options.skillState,
        execution: {
          cwd: options.cwd,
          db: options.db,
          enabledTools: effectiveTools,
          llmProfileConfig: options.llmProfileConfig,
          agentProfile: options.agentProfile,
          permissionOverride: options.permissionOverride,
          permissionCallback,
          abortSignal: options.abortController?.signal,
        },
      })
    );
  }

  const externalProviderCatalog = options.externalToolState
    ? buildExternalProviderCatalog(options.externalToolState, options.db)
    : '';
  const skillCatalog = options.skillState
    ? buildSkillCatalog(options.skillState, options.agentProfile)
    : '';
  const activeSkillContext = options.skillState ? buildActiveSkillContext(options.skillState) : '';

  const hooks = buildAgentHooks({
    permissionCallback:
      permissionCallback ??
      (async () => ({ behavior: 'deny', message: 'no permission callback provided' })),
    userHooks: options.userHooks,
    cwd: options.cwd,
    sessionId: options.claudiaSessionId,
    argOverrides,
    // P1-10: wire the shared run abort controller into the hooks so
    // shouldStopAfterTurn's abort check is live and Pre/PostToolUse hook
    // processes are cancelled when the run aborts.
    abortSignal: options.abortController?.signal,
  });

  return {
    tools,
    visibleToolNames: tools.map(tool => tool.name),
    externalProviderCatalog,
    skillCatalog,
    activeSkillContext,
    hooks,
  };
}

export { concreteMcpToolName };
