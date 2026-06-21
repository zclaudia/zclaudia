import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { ALL_TOOL_NAMES } from '@zclaudia/shared/core/tools';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { AgentProfileRepository } from '../repository.js';
import { LlmProfileRepository } from '../../llm-profiles/repository.js';

describe('AgentProfileRepository', () => {
  let db: Database.Database;
  let repo: AgentProfileRepository;
  let llmProfileId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    const llmRepo = new LlmProfileRepository(db);
    const lp = llmRepo.create({ name: 'test-llm', providerType: 'anthropic', apiKey: 'sk-test' });
    llmProfileId = lp.id;
    repo = new AgentProfileRepository(db);
  });

  it('creates and reads back all fields', () => {
    const created = repo.create({
      name: 'coder',
      description: 'Coding agent',
      llmProfileId,
      model: 'claude-sonnet-4-6',
      systemPrompt: 'You are a coder.',
      enabledTools: ['read', 'write', 'bash'],
      thinkingLevel: 'medium',
      isDefault: true,
    });
    const fetched = repo.findById(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe('coder');
    expect(fetched!.description).toBe('Coding agent');
    expect(fetched!.llmProfileId).toBe(llmProfileId);
    expect(fetched!.model).toBe('claude-sonnet-4-6');
    expect(fetched!.systemPrompt).toBe('You are a coder.');
    expect(fetched!.enabledTools).toEqual(['Read', 'Write', 'Bash']);
    expect(fetched!.toolSelection).toEqual({
      sets: [],
      providers: [],
      include: [
        { source: 'builtin', name: 'Read' },
        { source: 'builtin', name: 'Write' },
        { source: 'builtin', name: 'Bash' },
      ],
      exclude: [],
    });
    expect(fetched!.resolvedTools).toEqual([
      { source: 'builtin', name: 'Read' },
      { source: 'builtin', name: 'Write' },
      { source: 'builtin', name: 'Bash' },
    ]);
    expect(fetched!.thinkingLevel).toBe('medium');
    expect(fetched!.isDefault).toBe(true);
  });

  it('persists plugin ownership metadata for plugin-provided profiles', () => {
    const created = repo.create({
      name: 'ZCharlie',
      description: 'Plugin-owned investment analysis agent',
      llmProfileId,
      model: 'claude-sonnet-4-6',
      systemPrompt: 'You are ZCharlie.',
      enabledTools: ['read'],
      source: 'plugin',
      pluginId: 'com.zclaudia.zcharlie',
      pluginProfileId: 'default',
    });

    const fetched = repo.findById(created.id);

    expect(fetched!.source).toBe('plugin');
    expect(fetched!.pluginId).toBe('com.zclaudia.zcharlie');
    expect(fetched!.pluginProfileId).toBe('default');
  });

  it('persists toolSelection including future plugin refs without dropping them', () => {
    const created = repo.create({
      name: 'jira-agent',
      llmProfileId,
      model: 'm',
      systemPrompt: '',
      enabledTools: [],
      toolSelection: {
        sets: [{ source: 'builtin', id: 'core-coding' }],
        providers: [],
        include: [{ source: 'plugin', pluginId: 'jira', toolId: 'search' }],
        exclude: [{ source: 'builtin', name: 'Bash' }],
      },
    });

    const raw = db.prepare('SELECT tool_selection FROM agent_profiles WHERE id = ?').get(created.id) as {
      tool_selection: string;
    };
    const fetched = repo.findById(created.id);

    expect(JSON.parse(raw.tool_selection)).toEqual({
      sets: [{ source: 'builtin', id: 'core-coding' }],
      providers: [],
      include: [{ source: 'plugin', pluginId: 'jira', toolId: 'search' }],
      exclude: [{ source: 'builtin', name: 'Bash' }],
    });
    expect(fetched!.enabledTools).toEqual(['Read', 'Write', 'Edit', 'MultiEdit', 'ReadSymbol', 'EditSymbol', 'Eval', 'Grep', 'Glob', 'LS', 'EnterPlanMode', 'ExitPlanMode', 'Memory']);
    expect(fetched!.resolvedTools).toContainEqual({ source: 'plugin', pluginId: 'jira', toolId: 'search' });
  });

  it('persists discoverable external providers and pinned external tools', () => {
    const created = repo.create({
      name: 'external-agent',
      llmProfileId,
      model: 'm',
      systemPrompt: '',
      enabledTools: [],
      toolSelection: {
        sets: [{ source: 'builtin', id: 'core-coding' }],
        providers: [
          { source: 'mcp', serverId: 'github' },
          { source: 'plugin', pluginId: 'jira', providerId: 'issues' },
        ],
        include: [{ source: 'mcp', server: 'github', tool: 'search_repositories' }],
        exclude: [{ source: 'mcp', server: 'github', tool: 'delete_repository' }],
      },
    });

    const raw = db.prepare('SELECT tool_selection FROM agent_profiles WHERE id = ?').get(created.id) as {
      tool_selection: string;
    };
    const fetched = repo.findById(created.id);

    expect(JSON.parse(raw.tool_selection)).toEqual({
      sets: [{ source: 'builtin', id: 'core-coding' }],
      providers: [
        { source: 'mcp', serverId: 'github' },
        { source: 'plugin', pluginId: 'jira', providerId: 'issues' },
      ],
      include: [{ source: 'mcp', server: 'github', tool: 'search_repositories' }],
      exclude: [{ source: 'mcp', server: 'github', tool: 'delete_repository' }],
    });
    expect(fetched!.toolSelection?.providers).toEqual([
      { source: 'mcp', serverId: 'github' },
      { source: 'plugin', pluginId: 'jira', providerId: 'issues' },
    ]);
    expect(fetched!.toolSelection?.include).toContainEqual({
      source: 'mcp',
      server: 'github',
      tool: 'search_repositories',
    });
    expect(fetched!.enabledTools).toContain('Read');
    expect(fetched!.enabledTools).not.toContain('MCPTool');
  });

  it('persists and normalizes skillSelection', () => {
    const created = repo.create({
      name: 'skill-agent',
      llmProfileId,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
      skillSelection: {
        providers: [{ source: 'workspace' }, { source: 'external' }],
        include: [{ source: 'plugin', id: 'plugin-reviewer' }],
        exclude: [{ source: 'external', id: 'too-noisy' }],
        pinned: [{ source: 'workspace', id: 'coding-guidelines' }],
      },
    });

    const raw = db.prepare('SELECT skill_selection FROM agent_profiles WHERE id = ?').get(created.id) as {
      skill_selection: string;
    };
    const fetched = repo.findById(created.id);

    expect(JSON.parse(raw.skill_selection)).toEqual({
      providers: [{ source: 'workspace' }, { source: 'external' }],
      include: [{ source: 'plugin', id: 'plugin-reviewer' }],
      exclude: [{ source: 'external', id: 'too-noisy' }],
      pinned: [{ source: 'workspace', id: 'coding-guidelines' }],
    });
    expect(fetched!.skillSelection).toEqual({
      providers: [{ source: 'workspace' }, { source: 'external' }],
      include: [{ source: 'plugin', id: 'plugin-reviewer' }],
      exclude: [{ source: 'external', id: 'too-noisy' }],
      pinned: [{ source: 'workspace', id: 'coding-guidelines' }],
    });

    const updated = repo.update(created.id, {
      skillSelection: {
        providers: [{ source: 'plugin' }],
        pinned: [{ source: 'plugin', id: 'plugin-reviewer' }],
      },
    });

    expect(updated!.skillSelection).toEqual({
      providers: [{ source: 'plugin' }],
      include: [],
      exclude: [],
      pinned: [{ source: 'plugin', id: 'plugin-reviewer' }],
    });
  });

  it('persists and normalizes skillExecution overrides', () => {
    const created = repo.create({
      name: 'skill-policy-agent',
      llmProfileId,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
      skillExecution: {
        overrides: [
          {
            ref: { source: 'workspace', id: 'guidelines' },
            allowedModes: ['inline', 'fork'],
            defaultMode: 'fork',
            forkToolPolicy: 'web',
          },
          {
            ref: { source: 'workspace', id: 'guidelines' },
            allowedModes: ['inline'],
            defaultMode: 'inline',
            forkToolPolicy: 'dangerous' as never,
          },
        ],
      },
    });

    const raw = db.prepare('SELECT skill_execution FROM agent_profiles WHERE id = ?').get(created.id) as {
      skill_execution: string;
    };
    const fetched = repo.findById(created.id);

    expect(JSON.parse(raw.skill_execution)).toEqual({
      overrides: [
        {
          ref: { source: 'workspace', id: 'guidelines' },
          allowedModes: ['inline'],
          defaultMode: 'inline',
        },
      ],
    });
    expect(fetched!.skillExecution).toEqual({
      overrides: [
        {
          ref: { source: 'workspace', id: 'guidelines' },
          allowedModes: ['inline'],
          defaultMode: 'inline',
        },
      ],
    });

    const updated = repo.update(created.id, {
      skillExecution: {
        overrides: [
          {
            ref: { source: 'external', id: 'audit' },
            defaultMode: 'fork',
            forkToolPolicy: 'read-only',
          },
        ],
      },
    });

    expect(updated!.skillExecution).toEqual({
      overrides: [
        {
          ref: { source: 'external', id: 'audit' },
          defaultMode: 'fork',
          forkToolPolicy: 'read-only',
        },
      ],
    });
  });

  it('falls back to all canonical tools when enabled_tools JSON is corrupt', () => {
    const created = repo.create({
      name: 'a',
      llmProfileId,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
    });
    db.prepare('UPDATE agent_profiles SET enabled_tools = ?, tool_selection = NULL WHERE id = ?').run('{broken', created.id);
    const fetched = repo.findById(created.id);
    expect(fetched!.enabledTools.sort()).toEqual([...ALL_TOOL_NAMES].sort());
  });

  it('falls back to undefined when skill_selection JSON is corrupt', () => {
    const created = repo.create({
      name: 'a',
      llmProfileId,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
      skillSelection: {
        providers: [{ source: 'workspace' }],
        pinned: [{ source: 'workspace', id: 'guidelines' }],
      },
    });
    db.prepare('UPDATE agent_profiles SET skill_selection = ? WHERE id = ?').run('{broken', created.id);
    const fetched = repo.findById(created.id);
    expect(fetched!.skillSelection).toBeUndefined();
  });

  it('falls back to undefined when skill_execution JSON is corrupt', () => {
    const created = repo.create({
      name: 'a',
      llmProfileId,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
      skillExecution: {
        overrides: [{ ref: { source: 'workspace', id: 'guidelines' }, defaultMode: 'inline' }],
      },
    });
    db.prepare('UPDATE agent_profiles SET skill_execution = ? WHERE id = ?').run('{broken', created.id);
    const fetched = repo.findById(created.id);
    expect(fetched!.skillExecution).toBeUndefined();
  });

  it('falls back to undefined when thinking_level is unrecognized', () => {
    const created = repo.create({
      name: 'a',
      llmProfileId,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
    });
    db.prepare('UPDATE agent_profiles SET thinking_level = ? WHERE id = ?').run('extreme', created.id);
    const fetched = repo.findById(created.id);
    expect(fetched!.thinkingLevel).toBeUndefined();
  });

  it('findDefault returns the is_default=1 record', () => {
    repo.create({ name: 'a', llmProfileId, model: 'm', systemPrompt: '', enabledTools: ['read'] });
    const b = repo.create({
      name: 'b',
      llmProfileId,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
      isDefault: true,
    });
    const def = repo.findDefault();
    expect(def?.id).toBe(b.id);
  });

  it('setDefault clears previous default', () => {
    const a = repo.create({
      name: 'a',
      llmProfileId,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
      isDefault: true,
    });
    const b = repo.create({ name: 'b', llmProfileId, model: 'm', systemPrompt: '', enabledTools: ['read'] });
    repo.setDefault(b.id);
    expect(repo.findById(a.id)!.isDefault).toBe(false);
    expect(repo.findById(b.id)!.isDefault).toBe(true);
  });

  it('FK RESTRICT prevents deleting an llm_profile referenced by an agent', () => {
    repo.create({ name: 'a', llmProfileId, model: 'm', systemPrompt: '', enabledTools: ['read'] });
    expect(() => {
      db.prepare('DELETE FROM llm_profiles WHERE id = ?').run(llmProfileId);
    }).toThrow();
  });

  it('updates fields partially', () => {
    const created = repo.create({
      name: 'a',
      llmProfileId,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
    });
    const updated = repo.update(created.id, { name: 'a-updated', model: 'new-model' });
    expect(updated!.name).toBe('a-updated');
    expect(updated!.model).toBe('new-model');
    expect(updated!.systemPrompt).toBe('');
  });

});
