import type Database from 'better-sqlite3';
import type { ContextTemplate } from '../context/types.js';
import type { RunOptions } from '../../../infra/providers/types.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { ToolName } from '@zclaudia/shared/core/tools';
import {
  buildSkillDirectoryHint,
  getDiscoveredSkills,
  loadSkillContent,
  selectSkills,
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
    model?: string;
    sessionId: string;
    systemContext?: string;
    mode?: string;
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  } & Record<string, unknown>;
  modeValue: string;
  providerConfig?: LlmProfileConfig;
  providerType: string;
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
    sdkSessionId,
    serverPort,
    session,
    sessionType,
  } = input;

  const nativeToolSet = new Set(adapter?.policy?.nativeInteractionTools ?? []);
  const allInteractionTools = pluginToolRegistry.getAll().filter((tool) => tool.source === 'interaction');
  const injectableInteractionTools = allInteractionTools.filter((tool) => !nativeToolSet.has(tool.id));
  const hasInteractionTools = injectableInteractionTools.length > 0;

  const filePushEnv: Record<string, string> = {};
  let filePushContext: string | undefined;
  if (serverPort) {
    const apiUrl = `http://127.0.0.1:${serverPort}`;
    filePushEnv.ZCLAUDIA_API_URL = apiUrl;
    filePushEnv.ZCLAUDIA_SESSION_ID = message.sessionId;
    const hasPushFileTool = injectableInteractionTools.some((tool) => tool.id === 'push_file');
    if (!hasPushFileTool) {
      filePushContext = buildFilePushContext(apiUrl, message.sessionId);
    }
  }

  const nonNativePlanPrompt = modeValue === 'plan' && !providerSupportsNativePlanMode(adapter.manifest)
    ? buildNonNativePlanPrompt(providerType)
    : undefined;
  const planDocumentPrompt = forcedPlanBySession && session.task_id
    ? buildPlanDocumentPrompt(session.task_id)
    : undefined;
  const interactionToolPrompt = hasInteractionTools
    ? buildInteractionToolPrompt(injectableInteractionTools.map((tool) => tool.id))
    : undefined;

  const workspacePrompt = await workspaceService.assembleSystemPrompt({
    projectId: session.project_id || undefined,
    projectPath: session.root_path || undefined,
    skills: [],
  });
  const skillDirectoryHint = buildSkillDirectoryHint();

  const nativeMode = adapter.manifest
    ? mapPermissionMode(adapter.manifest as never, modeValue)
    : modeValue;

  let activeSkillsContent: string | undefined;
  if (sessionType === 'agent') {
    try {
      const allSkills = getDiscoveredSkills();
      const matched = selectSkills(allSkills, { userInput: message.input, os: process.platform });
      if (matched.length > 0) {
        activeSkillsContent = matched
          .map((skill) => loadSkillContent(skill.dirPath))
          .filter(Boolean)
          .join('\n\n---\n\n');
      }
    } catch {
      // Skill selection is best-effort and should not block run startup.
    }
  }

  const template = ((message as Record<string, unknown>)._contextTemplate || (sessionType === 'agent' ? 'agent' : 'coding')) as ContextTemplate;
  // NOTE: context-engine assembly is preserved so callers can still introspect
  // workspace/skill prompts in the future (e.g. via tracing). The RunOptions
  // systemPrompt below is intentionally driven solely by agentProfile.systemPrompt
  // per the agent-profiles spec (§4.6 — full replacement). When future work adds
  // a merge transform (e.g. AGENTS.md injection), this is where it goes.
  void createContextEngine().assemble(template, {
    sessionId: message.sessionId,
    projectId: session.project_id,
    cwd,
    workspacePrompt,
    skillDirectoryHint,
    systemContext: message.systemContext,
    activeSkillsContent,
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
      env: { ...(providerConfig?.env || {}), ...filePushEnv },
      mode: nativeMode,
      model: agentProfile.model,
      systemPrompt: agentProfile.systemPrompt,
      sessionTitle: session.name || undefined,
      serverPort: serverPort || undefined,
      claudiaSessionId: message.sessionId,
      db,
      llmProfileConfig: providerConfig,
      agentProfile,
      enabledTools,
      thinkingLevel: agentProfile.thinkingLevel,
    },
  };
}
