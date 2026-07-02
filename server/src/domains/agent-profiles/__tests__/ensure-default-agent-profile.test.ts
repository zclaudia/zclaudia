import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { ensureDefaultAgentProfile } from '../ensure-default-agent-profile.js';
import { AgentProfileRepository } from '../repository.js';
import { LlmProfileRepository } from '../../llm-profiles/repository.js';

const MODEL_ENV_KEYS = ['PI_MODEL', 'OPENAI_MODEL'] as const;

describe('ensureDefaultAgentProfile', () => {
  let db: Database.Database;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Isolate the model env knobs so an ambient .env.local can't sway the seed.
    for (const k of MODEL_ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
  });

  afterEach(() => {
    for (const k of MODEL_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
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
    expect(agents[0].enabledTools).toEqual([
      'Read',
      'Write',
      'Edit',
      'MultiEdit',
      'ReadSymbol',
      'EditSymbol',
      'Bash',
      'Eval',
      'Grep',
      'Glob',
      'LS',
      'EnterPlanMode',
      'ExitPlanMode',
      'Memory',
    ]);
    log.mockRestore();
  });

  it('seeds the agent model from OPENAI_MODEL when set (matches what the runtime requests)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.OPENAI_MODEL = 'kimi-k2.6';
    const llmRepo = new LlmProfileRepository(db);
    llmRepo.create({ name: 'a', providerType: 'openai', apiKey: 'sk', isDefault: true });

    ensureDefaultAgentProfile(db);

    const agents = new AgentProfileRepository(db).findAllOrdered();
    expect(agents[0].model).toBe('kimi-k2.6');
    log.mockRestore();
  });

  it('seeds claude-sonnet-4-6 by default when no model env knob is set', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const llmRepo = new LlmProfileRepository(db);
    llmRepo.create({ name: 'a', providerType: 'anthropic', apiKey: 'sk', isDefault: true });

    ensureDefaultAgentProfile(db);

    const agents = new AgentProfileRepository(db).findAllOrdered();
    expect(agents[0].model).toBe('claude-sonnet-4-6');
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
    const lp = llmRepo.create({
      name: 'a',
      providerType: 'anthropic',
      apiKey: 'sk',
      isDefault: true,
    });
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
