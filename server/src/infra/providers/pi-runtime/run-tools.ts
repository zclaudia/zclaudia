import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ToolName } from '@zclaudia/shared/core/tools';
import type { PermissionCallback, RunOptions } from '../types.js';
import { loadSessionSandboxDomains } from '../../../application/conversation/agent/permission-memory.js';
import { buildAgentHooks } from './agent-hooks.js';
import {
  buildExternalMetaTools,
  buildExternalProviderCatalog,
  concreteMcpToolName,
  createConcreteMcpTool,
  externalToolKey,
} from './external-tools.js';
import {
  buildActiveSkillContext,
  buildSkillCatalog,
  buildSkillMetaTools,
} from './skills.js';
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

export function buildPiRunToolBundle(input: {
  options: RunOptions;
  effectiveTools: ToolName[];
  supportsVision: boolean;
  isPlanMode: boolean;
  permissionCallback?: PermissionCallback;
}): PiRunToolBundle {
  const { options, effectiveTools, supportsVision, isPlanMode, permissionCallback } = input;
  const sandboxAllowedDomains = options.db && options.claudiaSessionId
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
  });
  if (options.externalToolState) {
    for (const ref of options.externalToolState.loadedExternalTools) {
      if (ref.source === 'mcp') {
        tools.push(createConcreteMcpTool(
          ref,
          options.db,
          options.externalToolState.loadedExternalToolSchemas?.[externalToolKey(ref)],
        ));
      }
    }
    tools.push(...buildExternalMetaTools({
      db: options.db,
      state: options.externalToolState,
      toolsArray: tools,
    }));
  }
  if (options.skillState) {
    tools.push(...buildSkillMetaTools({
      state: options.skillState,
      execution: {
        cwd: options.cwd,
        db: options.db,
        enabledTools: effectiveTools,
        llmProfileConfig: options.llmProfileConfig,
        agentProfile: options.agentProfile,
        permissionOverride: options.permissionOverride,
        permissionCallback,
      },
    }));
  }

  const externalProviderCatalog = options.externalToolState
    ? buildExternalProviderCatalog(options.externalToolState, options.db)
    : '';
  const skillCatalog = options.skillState
    ? buildSkillCatalog(options.skillState, options.agentProfile)
    : '';
  const activeSkillContext = options.skillState
    ? buildActiveSkillContext(options.skillState)
    : '';

  const hooks = buildAgentHooks({
    permissionCallback: permissionCallback ?? (async () => ({ behavior: 'deny', message: 'no permission callback provided' })),
    userHooks: options.userHooks,
    cwd: options.cwd,
    sessionId: options.claudiaSessionId,
  });

  return {
    tools,
    visibleToolNames: tools.map((tool) => tool.name),
    externalProviderCatalog,
    skillCatalog,
    activeSkillContext,
    hooks,
  };
}

export { concreteMcpToolName };
