import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
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
    expect(fetched!.enabledTools).toEqual(['read', 'write', 'bash']);
    expect(fetched!.thinkingLevel).toBe('medium');
    expect(fetched!.isDefault).toBe(true);
  });

  it('falls back to all 7 tools when enabled_tools JSON is corrupt', () => {
    const created = repo.create({
      name: 'a',
      llmProfileId,
      model: 'm',
      systemPrompt: '',
      enabledTools: ['read'],
    });
    db.prepare('UPDATE agent_profiles SET enabled_tools = ? WHERE id = ?').run('{broken', created.id);
    const fetched = repo.findById(created.id);
    expect(fetched!.enabledTools.sort()).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']);
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
