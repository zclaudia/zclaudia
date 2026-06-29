import type Database from 'better-sqlite3';
import { buildSkillDirectoryHint } from '../../../application/plugins/index.js';
import { createContextEngine } from '../../../application/conversation/context/engine.js';
import { buildMemoryContext } from '../../../application/conversation/context/memory-context.js';
import { workspaceService } from '../../../application/services/workspace.js';
import { resolveUserHooks } from '../../../application/conversation/runtime/resolve-user-hooks.js';
import { resolveProjectMemoryDir } from '../../../utils/memory-paths.js';
import { NoAgentAvailableError, resolveAgentForSession } from '../../agent-profiles/agent-resolver.js';
import { LlmProfileRepository } from '../../llm-profiles/repository.js';
import type {
  WorkflowAgentRuntime,
  WorkflowAgentRuntimePort,
  WorkflowAgentRuntimeRequest,
} from '../ports/step-executor.js';
import type { WorkflowAgentPermissionCallbackFactory } from './workflow-agent-permissions.js';

type UserHookDb = Parameters<typeof resolveUserHooks>[0];

export interface DefaultWorkflowAgentRuntimeResolverOptions {
  permissionCallbackFactory?: WorkflowAgentPermissionCallbackFactory;
}

export class DefaultWorkflowAgentRuntimeResolver implements WorkflowAgentRuntimePort {
  private readonly llmProfileRepository: LlmProfileRepository;

  constructor(
    private readonly db: Database.Database,
    private readonly options: DefaultWorkflowAgentRuntimeResolverOptions = {},
  ) {
    this.llmProfileRepository = new LlmProfileRepository(db);
  }

  async resolve(request: WorkflowAgentRuntimeRequest): Promise<WorkflowAgentRuntime> {
    const resolved = this.resolveAgent(request);
    const explicitLlmProfileId = normalizeOptionalString(request.llmProfileId);
    const llmProfileId = explicitLlmProfileId
      ?? resolved.llmProfileId
      ?? this.llmProfileRepository.findDefault()?.id;
    if (!llmProfileId) {
      throw new Error('No LLM profile configured for workflow agent runtime');
    }

    const model = normalizeOptionalString(request.model)
      ?? (explicitLlmProfileId && explicitLlmProfileId !== resolved.llmProfileId
        ? undefined
        : normalizeOptionalString(resolved.model));

    return {
      llmProfileId,
      model,
      systemPrompt: await this.buildSystemPrompt(request, resolved.systemPrompt),
      userHooks: request.projectId ? resolveUserHooks(this.db as unknown as UserHookDb, request.projectId) : undefined,
      permissionCallback: this.options.permissionCallbackFactory?.({
        projectId: request.projectId,
        runId: request.runId,
        cwd: request.cwd,
        purpose: request.purpose,
      }),
    };
  }

  private resolveAgent(request: WorkflowAgentRuntimeRequest): {
    llmProfileId?: string;
    model?: string;
    systemPrompt?: string;
  } {
    try {
      const { agent, llm } = resolveAgentForSession(this.db, { projectId: request.projectId });
      return {
        llmProfileId: llm?.id ?? agent.llmProfileId,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
      };
    } catch (err) {
      if (err instanceof NoAgentAvailableError && request.llmProfileId) {
        return {};
      }
      throw err;
    }
  }

  private async buildSystemPrompt(
    request: WorkflowAgentRuntimeRequest,
    agentSystemPrompt?: string,
  ): Promise<string> {
    const workspacePrompt = await workspaceService.assembleSystemPrompt({
      projectId: request.projectId,
      projectPath: request.projectRootPath ?? request.cwd,
      skills: [],
    });
    const memoryDir = request.projectId ? resolveProjectMemoryDir(request.projectId) : undefined;
    const memoryContext = memoryDir ? buildMemoryContext(memoryDir) : undefined;

    return createContextEngine().assemble('coding', {
      sessionId: request.runId,
      projectId: request.projectId,
      cwd: request.cwd,
      baseSystemPrompt: normalizeOptionalString(request.baseSystemPrompt) ?? normalizeOptionalString(agentSystemPrompt),
      workspacePrompt,
      skillDirectoryHint: buildSkillDirectoryHint(),
      memoryContext,
      systemContext: request.systemContext,
    });
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
