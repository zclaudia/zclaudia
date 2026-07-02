import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { resolveAgentForSession, NoAgentAvailableError } from '../agent-resolver.js';
import { AgentProfileRepository } from '../repository.js';
import { LlmProfileRepository } from '../../llm-profiles/repository.js';
import { ProjectRepository } from '../../projects/repository.js';

describe('resolveAgentForSession', () => {
  let db: Database.Database;
  let llmId: string;
  let globalDefaultAgentId: string;
  let projectDefaultAgentId: string;
  let projectWithDefault: string;
  let projectWithoutDefault: string;
  let explicitAgentId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    const llmRepo = new LlmProfileRepository(db);
    const agentRepo = new AgentProfileRepository(db);
    const projectRepo = new ProjectRepository(db);

    const llm = llmRepo.create({ name: 'test-llm', providerType: 'anthropic', apiKey: 'sk-test' });
    llmId = llm.id;

    const globalAgent = agentRepo.create({
      name: 'Global Default',
      llmProfileId: llmId,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
      isDefault: true,
    });
    globalDefaultAgentId = globalAgent.id;
    const projAgent = agentRepo.create({
      name: 'Project Default',
      llmProfileId: llmId,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
    });
    projectDefaultAgentId = projAgent.id;
    const explicit = agentRepo.create({
      name: 'Explicit',
      llmProfileId: llmId,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
    });
    explicitAgentId = explicit.id;

    const projWithDefault = projectRepo.create({
      name: 'p1',
      type: 'code',
      defaultAgentProfileId: projectDefaultAgentId,
      sortOrder: 0,
    });
    projectWithDefault = projWithDefault.id;
    const projWithoutDefault = projectRepo.create({ name: 'p2', type: 'code', sortOrder: 1 });
    projectWithoutDefault = projWithoutDefault.id;
  });

  it('uses explicitAgentId when provided', () => {
    const { agent, llm } = resolveAgentForSession(db, {
      explicitAgentId,
      projectId: projectWithDefault,
    });
    expect(agent.id).toBe(explicitAgentId);
    expect(llm?.id).toBe(llmId);
  });

  it('falls back to project default when no explicit', () => {
    const { agent } = resolveAgentForSession(db, { projectId: projectWithDefault });
    expect(agent.id).toBe(projectDefaultAgentId);
  });

  it('falls back to global default when project has no default', () => {
    const { agent } = resolveAgentForSession(db, { projectId: projectWithoutDefault });
    expect(agent.id).toBe(globalDefaultAgentId);
  });

  it('throws NoAgentAvailableError when nothing is set', () => {
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM agent_profiles').run();
    expect(() => resolveAgentForSession(db, {})).toThrow(NoAgentAvailableError);
  });

  it('logs warn and falls back to default when explicitAgentId is stale', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { agent } = resolveAgentForSession(db, {
      explicitAgentId: 'nonexistent',
      projectId: projectWithoutDefault,
    });
    expect(agent.id).toBe(globalDefaultAgentId);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nonexistent'));
    warn.mockRestore();
  });

  it('logs warn and falls back to default LLM when agent.llmProfileId is stale', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const llmRepo = new LlmProfileRepository(db);
    llmRepo.create({
      name: 'default-llm',
      providerType: 'anthropic',
      apiKey: 'sk',
      isDefault: true,
    });
    // Disable FK to simulate a stale llm_profile_id reference (real DBs can drift
    // when external tooling deletes rows; the resolver's fallback path must still work).
    db.pragma('foreign_keys = OFF');
    db.prepare('UPDATE agent_profiles SET llm_profile_id = ? WHERE id = ?').run(
      'nonexistent-llm',
      globalDefaultAgentId
    );
    db.pragma('foreign_keys = ON');
    const { llm } = resolveAgentForSession(db, { explicitAgentId: globalDefaultAgentId });
    expect(llm).toBeDefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('llm_profile_id'));
    warn.mockRestore();
  });
});
