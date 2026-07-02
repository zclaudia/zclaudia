import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { AgentProfileRepository } from '../../agent-profiles/repository.js';
import { LlmProfileRepository } from '../../llm-profiles/repository.js';
import { ProjectRepository } from '../../projects/repository.js';
import { workspaceService } from '../../../application/services/workspace.js';
import { DefaultWorkflowAgentRuntimeResolver } from '../step-executors/workflow-agent-runtime-resolver.js';

vi.mock('../../../application/services/workspace.js', () => ({
  workspaceService: {
    assembleSystemPrompt: vi.fn(async () => 'workspace instructions'),
  },
}));

describe('DefaultWorkflowAgentRuntimeResolver', () => {
  let db: Database.Database;
  let projectId: string;
  let llmId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    vi.mocked(workspaceService.assembleSystemPrompt).mockClear();
    vi.mocked(workspaceService.assembleSystemPrompt).mockResolvedValue('workspace instructions');

    const llm = new LlmProfileRepository(db).create({
      name: 'Primary',
      providerType: 'anthropic',
      apiKey: 'sk-test',
    });
    llmId = llm.id;

    const agent = new AgentProfileRepository(db).create({
      name: 'Project Agent',
      llmProfileId: llmId,
      model: 'agent-model',
      systemPrompt: 'agent instructions',
      enabledTools: ['Read'],
      isDefault: true,
    });

    const project = new ProjectRepository(db).create({
      name: 'Project',
      type: 'code',
      rootPath: '/repo',
      defaultAgentProfileId: agent.id,
      sortOrder: 0,
    });
    projectId = project.id;
  });

  it('uses the project default agent profile and appends workflow system context', async () => {
    db.prepare('UPDATE agent_config SET hooks = ? WHERE id = 1').run(
      JSON.stringify([{ event: 'PreToolUse', command: 'echo global' }])
    );
    db.prepare('UPDATE projects SET hooks_override = ? WHERE id = ?').run(
      JSON.stringify([{ event: 'PostToolUse', command: 'echo project' }]),
      projectId
    );
    const resolver = new DefaultWorkflowAgentRuntimeResolver(db);

    const runtime = await resolver.resolve({
      purpose: 'workflow.ai_prompt',
      runId: 'run-1',
      projectId,
      projectRootPath: '/repo',
      cwd: '/repo',
      llmProfileId: llmId,
      systemContext: 'Return JSON only.',
    });

    expect(runtime).toMatchObject({
      llmProfileId: llmId,
      model: 'agent-model',
      toolSessionId: 'run-1',
    });
    expect(runtime.systemPrompt).toContain('agent instructions');
    expect(runtime.systemPrompt).toContain('workspace instructions');
    expect(runtime.systemPrompt).toContain('Return JSON only.');
    expect(runtime.userHooks).toEqual([
      { event: 'PreToolUse', command: 'echo global' },
      { event: 'PostToolUse', command: 'echo project' },
    ]);
    expect(workspaceService.assembleSystemPrompt).toHaveBeenCalledWith({
      projectId,
      projectPath: '/repo',
      skills: [],
    });
  });

  it('does not reuse the agent model when the step selects a different LLM profile', async () => {
    const otherLlm = new LlmProfileRepository(db).create({
      name: 'Other',
      providerType: 'anthropic',
      apiKey: 'sk-other',
    });
    const resolver = new DefaultWorkflowAgentRuntimeResolver(db);

    const runtime = await resolver.resolve({
      purpose: 'workflow.ai_prompt',
      runId: 'run-1',
      projectId,
      projectRootPath: '/repo',
      cwd: '/repo',
      llmProfileId: otherLlm.id,
      systemContext: 'Return JSON only.',
    });

    expect(runtime.llmProfileId).toBe(otherLlm.id);
    expect(runtime.model).toBeUndefined();
    expect(runtime.systemPrompt).toContain('agent instructions');
  });

  it('passes provider type into workflow permission callbacks', async () => {
    const permissionCallback = vi.fn();
    const permissionCallbackFactory = vi.fn(() => permissionCallback);
    const resolver = new DefaultWorkflowAgentRuntimeResolver(db, {
      permissionCallbackFactory,
    });

    const runtime = await resolver.resolve({
      purpose: 'workflow.ai_prompt',
      runId: 'run-1',
      projectId,
      projectRootPath: '/repo',
      cwd: '/repo',
      llmProfileId: llmId,
      systemContext: 'Return JSON only.',
    });

    expect(runtime.permissionCallback).toBe(permissionCallback);
    expect(runtime.toolSessionId).toBe('run-1');
    expect(permissionCallbackFactory).toHaveBeenCalledWith({
      projectId,
      runId: 'run-1',
      cwd: '/repo',
      purpose: 'workflow.ai_prompt',
      providerType: 'anthropic',
    });
  });
});
