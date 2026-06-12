import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { ensureDefaultAgentProfile } from '../ensure-default-agent-profile.js';
import { AgentProfileRepository } from '../repository.js';
import { LlmProfileRepository } from '../../llm-profiles/repository.js';

describe('ensureDefaultAgentProfile', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
  });

  it('seeds a default agent when table is empty and LlmProfile exists', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const llmRepo = new LlmProfileRepository(db);
    llmRepo.create({ name: 'a', providerType: 'anthropic', apiKey: 'sk', isDefault: true });

    ensureDefaultAgentProfile(db);

    const agents = new AgentProfileRepository(db).findAllOrdered();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('Default Coding Agent');
    expect(agents[0].isDefault).toBe(true);
    expect(agents[0].toolSelection).toEqual({
      sets: [{ source: 'builtin', id: 'core-coding' }],
      providers: [],
      include: [],
      exclude: [],
    });
    expect(agents[0].enabledTools).toEqual(['Read', 'Write', 'Edit', 'Bash', 'Eval', 'Grep', 'Glob', 'LS']);
    log.mockRestore();
  });

  it('skips seeding when no LlmProfile exists, with a warn log', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ensureDefaultAgentProfile(db);
    const agents = new AgentProfileRepository(db).findAllOrdered();
    expect(agents).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no LlmProfile'));
    warn.mockRestore();
  });

  it('is a no-op when agent_profiles already has rows', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const llmRepo = new LlmProfileRepository(db);
    const lp = llmRepo.create({ name: 'a', providerType: 'anthropic', apiKey: 'sk', isDefault: true });
    const agentRepo = new AgentProfileRepository(db);
    agentRepo.create({
      name: 'existing',
      llmProfileId: lp.id,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
    });

    ensureDefaultAgentProfile(db);

    const agents = agentRepo.findAllOrdered();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('existing');
    log.mockRestore();
  });
});
