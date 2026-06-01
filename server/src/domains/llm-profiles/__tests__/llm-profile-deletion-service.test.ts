import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { LlmProfileRepository } from '../repository.js';
import { AgentProfileRepository } from '../../agent-profiles/repository.js';
import {
  LlmProfileDeletionService,
  LlmProfileInUseError,
  LlmProfileNotFoundError,
} from '../llm-profile-deletion-service.js';

describe('LlmProfileDeletionService', () => {
  let db: Database.Database;
  let service: LlmProfileDeletionService;
  let llmRepo: LlmProfileRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    llmRepo = new LlmProfileRepository(db);
    service = new LlmProfileDeletionService(db);
  });

  it('deletes an unreferenced LlmProfile', () => {
    const lp = llmRepo.create({ name: 'lp', providerType: 'anthropic', apiKey: 'sk' });

    expect(() => service.deleteLlmProfile(lp.id)).not.toThrow();
    expect(llmRepo.findById(lp.id)).toBeNull();
  });

  it('throws LlmProfileNotFoundError when the profile does not exist', () => {
    expect(() => service.deleteLlmProfile('missing-id')).toThrow(LlmProfileNotFoundError);
  });

  it('rejects deletion when an agent_profile references the LLM profile', () => {
    const lp = llmRepo.create({ name: 'lp', providerType: 'anthropic', apiKey: 'sk' });
    const agentRepo = new AgentProfileRepository(db);
    agentRepo.create({
      name: 'coder',
      llmProfileId: lp.id,
      model: 'claude-sonnet-4-6',
      systemPrompt: '',
      enabledTools: ['read'],
    });

    let caught: unknown;
    try {
      service.deleteLlmProfile(lp.id);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(LlmProfileInUseError);
    const inUse = caught as LlmProfileInUseError;
    expect(inUse.agentCount).toBe(1);
    expect(inUse.llmProfileId).toBe(lp.id);
    // Profile must remain (no partial cleanup).
    expect(llmRepo.findById(lp.id)).toBeDefined();
  });

  it('counts multiple referencing agent profiles', () => {
    const lp = llmRepo.create({ name: 'lp', providerType: 'anthropic', apiKey: 'sk' });
    const agentRepo = new AgentProfileRepository(db);
    agentRepo.create({
      name: 'a',
      llmProfileId: lp.id,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
    });
    agentRepo.create({
      name: 'b',
      llmProfileId: lp.id,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
    });

    try {
      service.deleteLlmProfile(lp.id);
      throw new Error('expected LlmProfileInUseError');
    } catch (err) {
      expect(err).toBeInstanceOf(LlmProfileInUseError);
      expect((err as LlmProfileInUseError).agentCount).toBe(2);
    }
  });
});
