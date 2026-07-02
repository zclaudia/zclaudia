import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { BuildRunContextInput } from '../run-context.js';

const assembleSystemPromptMock = vi.fn(async () => '## 项目上下文\n\nproject CLAUDE.md content');
const buildSkillDirectoryHintMock = vi.fn(() => '<available_skills>hint</available_skills>');
const toolRegistryGetAllMock = vi.fn(() => [] as Array<{ id: string; source: string }>);

vi.mock('../../../services/workspace.js', () => ({
  workspaceService: {
    assembleSystemPrompt: assembleSystemPromptMock,
  },
}));

vi.mock('../../../../application/plugins/index.js', () => ({
  buildSkillDirectoryHint: buildSkillDirectoryHintMock,
  toolRegistry: {
    getAll: toolRegistryGetAllMock,
  },
}));

function createAgentProfile(overrides: Partial<AgentProfileConfig> = {}): AgentProfileConfig {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    llmProfileId: 'provider-1',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'You are the profile-defined assistant.',
    enabledTools: ['Read', 'Bash'],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function createInput(overrides: Partial<BuildRunContextInput> = {}): BuildRunContextInput {
  return {
    adapter: {},
    agentProfile: createAgentProfile(),
    cwd: '/tmp/project',
    db: {} as never,
    enabledTools: ['Read', 'Bash'] as never,
    forcedPlanBySession: false,
    message: {
      input: 'hello',
      sessionId: 'session-1',
    },
    modeValue: 'default',
    providerType: 'anthropic',
    runId: 'run-1',
    serverPort: null,
    session: {
      id: 'session-1',
      project_id: 'project-1',
      name: 'Test Session',
      root_path: '/tmp/project',
      task_id: null,
    },
    sessionType: 'regular',
    ...overrides,
  };
}

describe('buildRunContext — workspace prompt merge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assembleSystemPromptMock.mockResolvedValue('## 项目上下文\n\nproject CLAUDE.md content');
    buildSkillDirectoryHintMock.mockReturnValue('<available_skills>hint</available_skills>');
    toolRegistryGetAllMock.mockReturnValue([]);
  });

  it('merges workspace/project instructions after the agent profile prompt', async () => {
    const { buildRunContext } = await import('../run-context.js');

    const { runOptions } = await buildRunContext(createInput());

    expect(runOptions.systemPrompt).toBeDefined();
    expect(runOptions.systemPrompt!.startsWith('You are the profile-defined assistant.')).toBe(
      true
    );
    expect(runOptions.systemPrompt).toContain('project CLAUDE.md content');
    expect(runOptions.systemPrompt!.indexOf('You are the profile-defined assistant.')).toBeLessThan(
      runOptions.systemPrompt!.indexOf('project CLAUDE.md content')
    );
    expect(runOptions.systemPrompt).toContain('<available_skills>hint</available_skills>');
  });

  it('agent sessions use the profile prompt as base, not the built-in agent persona', async () => {
    const { buildRunContext } = await import('../run-context.js');

    const { runOptions } = await buildRunContext(createInput({ sessionType: 'agent' }));

    expect(runOptions.systemPrompt!.startsWith('You are the profile-defined assistant.')).toBe(
      true
    );
    expect(runOptions.systemPrompt).not.toContain('Agent Assistant for ZClaudia');
    expect(runOptions.systemPrompt).toContain('project CLAUDE.md content');
  });

  it('falls back to the bare profile prompt when no workspace content exists', async () => {
    assembleSystemPromptMock.mockResolvedValue('');
    buildSkillDirectoryHintMock.mockReturnValue('');
    const { buildRunContext } = await import('../run-context.js');

    const { runOptions } = await buildRunContext(createInput());

    expect(runOptions.systemPrompt).toBe('You are the profile-defined assistant.');
  });

  it('produces a byte-identical system prompt across runs of the same session (cache prefix stability)', async () => {
    const { buildRunContext } = await import('../run-context.js');

    const first = await buildRunContext(createInput({ serverPort: 3100 }));
    const second = await buildRunContext(createInput({ serverPort: 3100 }));

    expect(first.runOptions.systemPrompt).toBe(second.runOptions.systemPrompt);
  });
});
