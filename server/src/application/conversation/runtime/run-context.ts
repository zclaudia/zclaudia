import type Database from 'better-sqlite3';
import type { ContextTemplate } from '../context/types.js';
import type { RunOptions } from '../../../infra/providers/types.js';
import type { UnifiedPermissionPolicy } from '@zclaudia/shared/interaction/permissions';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { ToolName } from '@zclaudia/shared/core/tools';
import type { TaskExecutor } from '../../../domains/tasks/executors/types.js';
import {
  buildSkillDirectoryHint,
  toolRegistry as pluginToolRegistry,
} from '../../../application/plugins/index.js';
import {
  providerSupportsNativePlanMode,
  buildNonNativePlanPrompt,
  buildPlanDocumentPrompt,
  buildFilePushContext,
  buildInteractionToolPrompt,
} from '../../../utils/server-utils.js';
import { createContextEngine } from '../context/engine.js';
import { buildMemoryContext } from '../context/memory-context.js';
import { resolveProjectMemoryDir } from '../../../utils/memory-paths.js';
import { workspaceService } from '../../services/workspace.js';
import { mapPermissionMode } from '../../../infra/providers/pcp-permission.js';

interface SessionContext {
  id: string;
  project_id: string;
  name: string | null;
  root_path: string | null;
  task_id: string | null;
}

interface AdapterContext {
  manifest?: {
    permissionModeMap?: Record<string, string | undefined>;
  };
  policy?: {
    nativeInteractionTools?: string[];
  };
}

export interface BuildRunContextInput {
  adapter: AdapterContext;
  agentProfile: AgentProfileConfig;
  cwd: string;
  db: Database.Database;
  enabledTools: ToolName[];
  forcedPlanBySession: boolean;
  message: {
    input: string;
    sessionId: string;
    systemContext?: string;
    mode?: string;
  } & Record<string, unknown>;
  modeValue: string;
  providerConfig?: LlmProfileConfig;
  providerType: string;
  runId: string;
  agentTaskExecutor?: TaskExecutor;
  sdkSessionId?: string;
  serverPort: number | null;
  session: SessionContext;
  sessionType: 'regular' | 'background' | 'agent';
}

export async function buildRunContext(input: BuildRunContextInput): Promise<{
  nativeMode: string;
  runOptions: RunOptions;
}> {
  const {
    adapter,
    agentProfile,
    cwd,
    db,
    enabledTools,
    forcedPlanBySession,
    message,
    modeValue,
    providerConfig,
    providerType,
    runId,
    agentTaskExecutor,
    sdkSessionId,
    serverPort,
    session,
    sessionType,
  } = input;

  const nativeToolSet = new Set(adapter?.policy?.nativeInteractionTools ?? []);
  const allInteractionTools = pluginToolRegistry
    .getAll()
    .filter(tool => tool.source === 'interaction');
  const injectableInteractionTools = allInteractionTools.filter(
    tool => !nativeToolSet.has(tool.id)
  );
  const hasInteractionTools = injectableInteractionTools.length > 0;

  const filePushEnv: Record<string, string> = {};
  let filePushContext: string | undefined;
  if (serverPort) {
    const apiUrl = `http://127.0.0.1:${serverPort}`;
    filePushEnv.ZCLAUDIA_API_URL = apiUrl;
    filePushEnv.ZCLAUDIA_SESSION_ID = message.sessionId;
    const hasPushFileTool = injectableInteractionTools.some(tool => tool.id === 'push_file');
    if (!hasPushFileTool) {
      filePushContext = buildFilePushContext(apiUrl, message.sessionId);
    }
  }

  const nonNativePlanPrompt =
    modeValue === 'plan' && !providerSupportsNativePlanMode(adapter.manifest)
      ? buildNonNativePlanPrompt(providerType)
      : undefined;
  const planDocumentPrompt =
    forcedPlanBySession && session.task_id ? buildPlanDocumentPrompt(session.task_id) : undefined;
  const interactionToolPrompt = hasInteractionTools
    ? buildInteractionToolPrompt(injectableInteractionTools.map(tool => tool.id))
    : undefined;

  const workspacePrompt = await workspaceService.assembleSystemPrompt({
    projectId: session.project_id || undefined,
    projectPath: session.root_path || undefined,
    skills: [],
  });
  const memoryDir = session.project_id ? resolveProjectMemoryDir(session.project_id) : undefined;
  const memoryContext = memoryDir ? buildMemoryContext(memoryDir) : undefined;
  const skillDirectoryHint = buildSkillDirectoryHint();

  const nativeMode = adapter.manifest
    ? mapPermissionMode(adapter.manifest as never, modeValue)
    : modeValue;

  const template = ((message as Record<string, unknown>)._contextTemplate ||
    (sessionType === 'agent' ? 'agent' : 'coding')) as ContextTemplate;
  // Merge transform: agentProfile.systemPrompt fully replaces the template's
  // built-in persona (§4.6) and leads the prompt; workspace/project instructions
  // (SOUL.md/AGENTS.md/TOOLS.md/CLAUDE.md) and run context fragments are appended
  // after it. Every fragment is deterministic per session (no timestamps), so the
  // prompt-cache prefix stays stable across runs.
  const systemPrompt = createContextEngine().assemble(template, {
    sessionId: message.sessionId,
    projectId: session.project_id,
    cwd,
    baseSystemPrompt: agentProfile.systemPrompt,
    workspacePrompt,
    skillDirectoryHint,
    memoryContext,
    systemContext: message.systemContext,
    nonNativePlanPrompt,
    planDocumentPrompt,
    filePushContext,
    interactionToolPrompt,
  });

  return {
    nativeMode,
    runOptions: {
      cwd,
      sessionId: sdkSessionId,
      env: filePushEnv,
      mode: message.mode || 'default',
      systemPrompt,
      sessionTitle: session.name || undefined,
      serverPort: serverPort || undefined,
      claudiaSessionId: message.sessionId,
      runId,
      permissionOverride: message.permissionOverride as
        | Partial<UnifiedPermissionPolicy>
        | undefined,
      memoryDir,
      db,
      agentTaskExecutor,
      llmProfileConfig: providerConfig,
      agentProfile,
      enabledTools,
      thinkingLevel: agentProfile.thinkingLevel,
    },
  };
}
