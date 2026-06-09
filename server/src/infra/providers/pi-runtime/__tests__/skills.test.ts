import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildActiveSkillContext,
  buildSkillCatalog,
  buildSkillMetaTools,
  createSkillRuntimeState,
  resolveSkillExecutionPolicy,
} from '../skills.js';

const { loadDiscoveredSkillContentMock } = vi.hoisted(() => ({
  loadDiscoveredSkillContentMock: vi.fn(),
}));

vi.mock('../../../../application/plugins/skill-tools.js', () => ({
  loadDiscoveredSkillContent: loadDiscoveredSkillContentMock,
}));

function textFrom(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return content[0]?.text ?? '';
}

function jsonFrom(result: unknown): any {
  return JSON.parse(textFrom(result));
}

describe('progressive skill runtime', () => {
  beforeEach(() => {
    loadDiscoveredSkillContentMock.mockReset();
  });

  it('resolves execution policy from source defaults and heuristics', () => {
    expect(resolveSkillExecutionPolicy({
      id: 'coding-guidelines',
      name: 'coding-guidelines',
      description: 'Follow project conventions when editing code',
      source: 'workspace',
      filePath: '/skills/coding-guidelines/SKILL.md',
      dirPath: '/skills/coding-guidelines',
    })).toEqual(expect.objectContaining({
      modes: ['inline', 'fork'],
      defaultMode: 'inline',
    }));

    expect(resolveSkillExecutionPolicy({
      id: 'security-audit',
      name: 'security-audit',
      description: 'Audit and report security issues',
      source: 'external',
      filePath: '/skills/security-audit/SKILL.md',
      dirPath: '/skills/security-audit',
    })).toEqual(expect.objectContaining({
      modes: ['inline', 'fork'],
      defaultMode: 'fork',
      source: 'heuristic',
    }));

    expect(resolveSkillExecutionPolicy({
      id: 'plugin-reviewer',
      name: 'plugin-reviewer',
      description: 'Review code',
      source: 'plugin',
      filePath: '/plugin/skills/plugin-reviewer/SKILL.md',
      dirPath: '/plugin/skills/plugin-reviewer',
    })).toEqual(expect.objectContaining({
      modes: ['fork'],
      defaultMode: 'fork',
      source: 'source-default',
    }));
  });

  it('layers profile overrides above skill metadata and heuristic defaults', () => {
    const skill = {
      id: 'security-audit',
      name: 'security-audit',
      description: 'Audit and report security issues',
      source: 'external' as const,
      filePath: '/skills/security-audit/SKILL.md',
      dirPath: '/skills/security-audit',
      execution: {
        allowedModes: ['inline', 'fork'] as const,
        defaultMode: 'inline' as const,
        forkToolPolicy: 'web' as const,
      },
    };

    expect(resolveSkillExecutionPolicy(skill)).toEqual(expect.objectContaining({
      defaultMode: 'inline',
      forkToolPolicy: 'web',
      source: 'skill-metadata',
    }));

    expect(resolveSkillExecutionPolicy(skill, undefined, {
      id: 'agent-1',
      name: 'Agent',
      llmProfileId: 'llm-1',
      model: 'm',
      systemPrompt: '',
      enabledTools: [],
      skillExecution: {
        overrides: [
          {
            ref: { source: 'external', id: 'security-audit' },
            allowedModes: ['fork'],
            defaultMode: 'fork',
            forkToolPolicy: 'read-only',
          },
        ],
      },
      createdAt: 0,
      updatedAt: 0,
    })).toEqual(expect.objectContaining({
      modes: ['fork'],
      defaultMode: 'fork',
      forkToolPolicy: 'read-only',
      source: 'profile-override',
    }));
  });

  it('normalizes invalid default modes and rejects plugin inline expansion', () => {
    const policy = resolveSkillExecutionPolicy({
      id: 'guidelines',
      name: 'guidelines',
      description: 'Follow project rules',
      source: 'workspace',
      filePath: '/skills/guidelines/SKILL.md',
      dirPath: '/skills/guidelines',
      execution: {
        allowedModes: ['fork'],
        defaultMode: 'inline',
      },
    });

    expect(policy).toEqual(expect.objectContaining({
      modes: ['fork'],
      defaultMode: 'fork',
      source: 'skill-metadata',
    }));
    expect(policy.diagnostics).toContain('default_mode_not_allowed');

    const pluginPolicy = resolveSkillExecutionPolicy({
      id: 'plugin-reviewer',
      name: 'plugin-reviewer',
      description: 'Plugin reviewer',
      source: 'plugin',
      filePath: '/plugin/reviewer/SKILL.md',
      dirPath: '/plugin/reviewer',
    }, undefined, {
      id: 'agent-1',
      name: 'Agent',
      llmProfileId: 'llm-1',
      model: 'm',
      systemPrompt: '',
      enabledTools: [],
      skillExecution: {
        overrides: [
          {
            ref: { source: 'plugin', id: 'plugin-reviewer' },
            allowedModes: ['inline'],
            defaultMode: 'inline',
          },
        ],
      },
      createdAt: 0,
      updatedAt: 0,
    });

    expect(pluginPolicy).toEqual(expect.objectContaining({
      modes: ['fork'],
      defaultMode: 'fork',
    }));
    expect(pluginPolicy.diagnostics).toContain('profile_override_cannot_expand_modes');
  });

  it('lists, searches, inspects, and loads skills into active session context', async () => {
    loadDiscoveredSkillContentMock.mockResolvedValue('# Design Spec\nFollow the TDS workflow.');
    const state = createSkillRuntimeState([
      {
        id: 'design-spec',
        name: 'design-spec',
        description: 'Write technical design specs',
        source: 'workspace',
        filePath: '/skills/design-spec/SKILL.md',
        dirPath: '/skills/design-spec',
      },
      {
        id: 'reviewer',
        name: 'reviewer',
        description: 'Review code changes',
        source: 'workspace',
        filePath: '/skills/reviewer/SKILL.md',
        dirPath: '/skills/reviewer',
      },
    ]);
    const metaTools = buildSkillMetaTools({ state });

    const catalog = buildSkillCatalog(state);
    expect(catalog).toContain('design-spec');
    expect(catalog).toContain('defaultMode=');

    const listResult = await metaTools.find((tool) => tool.name === 'ListSkills')!.execute('list-1', {});
    expect(textFrom(listResult)).toContain('design-spec');
    expect(jsonFrom(listResult).skills[0].executionPolicy).toEqual(expect.objectContaining({
      modes: expect.any(Array),
      defaultMode: expect.any(String),
    }));

    const searchResult = await metaTools.find((tool) => tool.name === 'SearchSkills')!.execute('search-1', {
      query: 'review',
    });
    const searchText = textFrom(searchResult);
    expect(searchText).toContain('reviewer');
    expect(searchText).not.toContain('design-spec');

    const inspectResult = await metaTools.find((tool) => tool.name === 'InspectSkill')!.execute('inspect-1', {
      ref: { source: 'workspace', id: 'design-spec' },
    });
    const inspectText = textFrom(inspectResult);
    expect(inspectText).toContain('Write technical design specs');
    expect(inspectText).not.toContain('Follow the TDS workflow');
    expect(jsonFrom(inspectResult).executionPolicy).toEqual(expect.objectContaining({
      modes: ['inline', 'fork'],
    }));

    const loadResult = await metaTools.find((tool) => tool.name === 'LoadSkill')!.execute('load-1', {
      ref: { source: 'workspace', id: 'design-spec' },
    });

    expect(textFrom(loadResult)).toContain('loaded');
    expect(state.loadedSkills).toEqual([{ source: 'workspace', id: 'design-spec' }]);
    expect(buildActiveSkillContext(state)).toContain('# Design Spec');
    expect(buildActiveSkillContext(state)).toContain('Follow the TDS workflow.');
  });

  it('enforces inline and fork execution policies without mutating active context on denial', async () => {
    loadDiscoveredSkillContentMock.mockResolvedValue('# Should not load');
    const state = createSkillRuntimeState([
      {
        id: 'fork-only',
        name: 'fork-only',
        description: 'Audit and report',
        source: 'workspace',
        filePath: '/skills/fork-only/SKILL.md',
        dirPath: '/skills/fork-only',
        execution: {
          allowedModes: ['fork'],
          defaultMode: 'fork',
        },
      },
      {
        id: 'inline-only',
        name: 'inline-only',
        description: 'Follow conventions',
        source: 'workspace',
        filePath: '/skills/inline-only/SKILL.md',
        dirPath: '/skills/inline-only',
        execution: {
          allowedModes: ['inline'],
          defaultMode: 'inline',
        },
      },
    ]);
    const metaTools = buildSkillMetaTools({ state });

    const loadDenied = await metaTools.find((tool) => tool.name === 'LoadSkill')!.execute('load-denied', {
      ref: { source: 'workspace', id: 'fork-only' },
    });
    expect(jsonFrom(loadDenied)).toEqual(expect.objectContaining({
      ok: false,
      error: 'policy_denied_inline',
    }));

    const runDenied = await metaTools.find((tool) => tool.name === 'RunSkill')!.execute('run-denied', {
      ref: { source: 'workspace', id: 'inline-only' },
      task: 'Do the thing',
      mode: 'fork',
    });
    expect(jsonFrom(runDenied)).toEqual(expect.objectContaining({
      ok: false,
      error: 'policy_denied_fork',
    }));

    expect(state.loadedSkills).toEqual([]);
    expect(state.loadedSkillContents).toEqual({});
  });

  it('validates RunSkill input without mutating active skill context', async () => {
    const state = createSkillRuntimeState([
      {
        id: 'security-audit',
        name: 'security-audit',
        description: 'Audit and report security issues',
        source: 'external',
        filePath: '/skills/security-audit/SKILL.md',
        dirPath: '/skills/security-audit',
      },
    ]);
    const metaTools = buildSkillMetaTools({ state });
    const runSkill = metaTools.find((tool) => tool.name === 'RunSkill');
    expect(runSkill).toBeDefined();

    const missingTask = await runSkill!.execute('run-1', {
      ref: { source: 'external', id: 'security-audit' },
    });
    expect(jsonFrom(missingTask)).toEqual(expect.objectContaining({
      ok: false,
      error: 'missing_task',
    }));

    const inlineMode = await runSkill!.execute('run-2', {
      ref: { source: 'external', id: 'security-audit' },
      task: 'Check auth code',
      mode: 'inline',
    });
    expect(jsonFrom(inlineMode)).toEqual(expect.objectContaining({
      ok: false,
      error: 'inline_mode_not_supported',
    }));
    expect(textFrom(inlineMode)).toContain('LoadSkill');

    expect(state.loadedSkills).toEqual([]);
    expect(state.loadedSkillContents).toEqual({});
    expect(buildActiveSkillContext(state)).toBe('');
  });

  it('executes RunSkill through a forked worker with read-only tools', async () => {
    loadDiscoveredSkillContentMock.mockResolvedValue('# Security Audit\nReview the code for auth issues.');
    const nestedAgents: any[] = [];
    const agentFactory = (opts: any) => {
      let listener: ((event: any) => void) | undefined;
      const agent = {
        initialState: opts.initialState,
        subscribe: (fn: (event: any) => void) => {
          listener = fn;
          return () => { listener = undefined; };
        },
        prompt: vi.fn(async () => {
          listener?.({
            type: 'agent_end',
            messages: [
              {
                role: 'assistant',
                content: [{ type: 'text', text: 'Audit result: no obvious auth issue.' }],
              },
            ],
          });
        }),
      };
      nestedAgents.push(agent);
      return agent;
    };
    const state = createSkillRuntimeState([
      {
        id: 'security-audit',
        name: 'security-audit',
        description: 'Audit and report security issues',
        source: 'external',
        filePath: '/skills/security-audit/SKILL.md',
        dirPath: '/skills/security-audit',
      },
    ]);
    const metaTools = buildSkillMetaTools({
      state,
      execution: {
        cwd: '/tmp/project',
        enabledTools: ['Read', 'Grep', 'Write'],
        agentFactory,
      },
    } as any);

    const result = await metaTools.find((tool) => tool.name === 'RunSkill')!.execute('run-3', {
      ref: { source: 'external', id: 'security-audit' },
      task: 'Check authentication changes',
    });

    expect(jsonFrom(result)).toEqual(expect.objectContaining({
      ok: true,
      mode: 'fork',
      result: 'Audit result: no obvious auth issue.',
      executionId: expect.any(String),
      durationMs: expect.any(Number),
      forkToolPolicy: 'read-only',
      enabledForkTools: ['Read', 'Grep'],
    }));
    expect(loadDiscoveredSkillContentMock).toHaveBeenCalledWith({ source: 'external', id: 'security-audit' });
    expect(nestedAgents).toHaveLength(1);
    expect(nestedAgents[0].initialState.systemPrompt).toContain('# Security Audit');
    expect(nestedAgents[0].initialState.tools.map((tool: any) => tool.name).sort()).toEqual(['Grep', 'Read']);
    expect(state.loadedSkills).toEqual([]);
    expect(state.loadedSkillContents).toEqual({});
  });

  it('returns structured RunSkill diagnostics when forked execution fails', async () => {
    loadDiscoveredSkillContentMock.mockResolvedValue('# Broken Skill\nTry to run.');
    const state = createSkillRuntimeState([
      {
        id: 'broken',
        name: 'broken',
        description: 'Audit and report',
        source: 'external',
        filePath: '/skills/broken/SKILL.md',
        dirPath: '/skills/broken',
      },
    ]);
    const runSkill = buildSkillMetaTools({
      state,
      execution: {
        cwd: '/tmp/project',
        enabledTools: ['Read'],
        agentFactory: () => ({
          subscribe: () => () => {},
          prompt: vi.fn(async () => {
            throw new Error('nested failure');
          }),
        }),
      },
    } as any).find((tool) => tool.name === 'RunSkill')!;

    const result = await runSkill.execute('run-failure', {
      ref: { source: 'external', id: 'broken' },
      task: 'Run broken skill',
      mode: 'fork',
    });

    expect(jsonFrom(result)).toEqual(expect.objectContaining({
      ok: false,
      error: 'skill_execution_failed',
      message: 'nested failure',
      executionId: expect.any(String),
      durationMs: expect.any(Number),
      forkToolPolicy: 'read-only',
      enabledForkTools: ['Read'],
    }));
  });

  it('uses fork tool policy without granting tools absent from the parent profile', async () => {
    loadDiscoveredSkillContentMock.mockResolvedValue('# Web Audit\nSearch current guidance.');
    const nestedAgents: any[] = [];
    const agentFactory = (opts: any) => {
      let listener: ((event: any) => void) | undefined;
      const agent = {
        initialState: opts.initialState,
        subscribe: (fn: (event: any) => void) => {
          listener = fn;
          return () => { listener = undefined; };
        },
        prompt: vi.fn(async () => {
          listener?.({
            type: 'agent_end',
            messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }],
          });
        }),
      };
      nestedAgents.push(agent);
      return agent;
    };
    const state = createSkillRuntimeState([
      {
        id: 'web-audit',
        name: 'web-audit',
        description: 'Audit using web search',
        source: 'external',
        filePath: '/skills/web-audit/SKILL.md',
        dirPath: '/skills/web-audit',
        execution: {
          allowedModes: ['fork'],
          defaultMode: 'fork',
          forkToolPolicy: 'web',
        },
      },
      {
        id: 'editor',
        name: 'editor',
        description: 'Edit files',
        source: 'workspace',
        filePath: '/skills/editor/SKILL.md',
        dirPath: '/skills/editor',
        execution: {
          allowedModes: ['fork'],
          defaultMode: 'fork',
          forkToolPolicy: 'workspace-edit',
        },
      },
    ]);
    const runSkill = buildSkillMetaTools({
      state,
      execution: {
        cwd: '/tmp/project',
        enabledTools: ['Read', 'Grep', 'WebFetch', 'Edit'],
        agentFactory,
      },
    } as any).find((tool) => tool.name === 'RunSkill')!;

    await runSkill.execute('run-web', {
      ref: { source: 'external', id: 'web-audit' },
      task: 'Search and audit',
      mode: 'fork',
    });
    expect(nestedAgents[0].initialState.tools.map((tool: any) => tool.name).sort()).toEqual([
      'Grep',
      'Read',
      'WebFetch',
    ]);

    await runSkill.execute('run-edit', {
      ref: { source: 'workspace', id: 'editor' },
      task: 'Edit carefully',
      mode: 'fork',
    });
    expect(nestedAgents[1].initialState.tools.map((tool: any) => tool.name).sort()).toEqual([
      'Edit',
      'Grep',
      'Read',
    ]);
  });

  it('guides inline-default skills to LoadSkill unless fork is explicit', async () => {
    loadDiscoveredSkillContentMock.mockResolvedValue('# Coding Guidelines\nFollow project conventions.');
    const state = createSkillRuntimeState([
      {
        id: 'coding-guidelines',
        name: 'coding-guidelines',
        description: 'Follow project conventions',
        source: 'workspace',
        filePath: '/skills/coding-guidelines/SKILL.md',
        dirPath: '/skills/coding-guidelines',
      },
    ]);
    const agentFactory = (opts: any) => {
      let listener: ((event: any) => void) | undefined;
      return {
        initialState: opts.initialState,
        subscribe: (fn: (event: any) => void) => {
          listener = fn;
          return () => { listener = undefined; };
        },
        prompt: vi.fn(async () => {
          listener?.({
            type: 'agent_end',
            messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Use these conventions.' }] }],
          });
        }),
      };
    };
    const runSkill = buildSkillMetaTools({
      state,
      execution: { cwd: '/tmp/project', enabledTools: ['Read'], agentFactory },
    } as any).find((tool) => tool.name === 'RunSkill')!;

    const defaultMode = await runSkill.execute('run-4', {
      ref: { source: 'workspace', id: 'coding-guidelines' },
      task: 'Apply coding style',
    });
    expect(jsonFrom(defaultMode)).toEqual(expect.objectContaining({
      ok: false,
      error: 'use_load_skill',
    }));

    const explicitFork = await runSkill.execute('run-5', {
      ref: { source: 'workspace', id: 'coding-guidelines' },
      task: 'Apply coding style',
      mode: 'fork',
    });
    expect(jsonFrom(explicitFork)).toEqual(expect.objectContaining({
      ok: true,
      result: 'Use these conventions.',
    }));
    expect(state.loadedSkills).toEqual([]);
    expect(state.loadedSkillContents).toEqual({});
  });
});
