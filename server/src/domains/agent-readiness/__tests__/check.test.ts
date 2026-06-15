import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { AgentProfileRepository } from '../../agent-profiles/repository.js';
import { LlmProfileRepository } from '../../llm-profiles/repository.js';
import { resolveAgentReadiness } from '../check.js';

let db: Database.Database;
const SAVED: Record<string, string | undefined> = {};
const ENV = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_BASE_URL'];

beforeEach(() => {
  for (const k of ENV) { SAVED[k] = process.env[k]; delete process.env[k]; }
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
});

afterEach(() => {
  db.close();
  for (const k of ENV) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; }
});

function seedLlm(apiKey?: string): string {
  const llmRepo = new LlmProfileRepository(db);
  const lp = llmRepo.create({ name: 'test-llm', providerType: 'anthropic', apiKey, isDefault: true });
  return lp.id;
}

function seedAgent(llmProfileId: string) {
  const agentRepo = new AgentProfileRepository(db);
  agentRepo.create({
    name: 'test-agent',
    llmProfileId,
    model: 'claude-sonnet-4-6',
    systemPrompt: '',
    enabledTools: ['read'],
    isDefault: true,
  });
}

describe('resolveAgentReadiness', () => {
  it('no_agent when there are no agent profiles', () => {
    expect(resolveAgentReadiness(db)).toEqual({ usable: false, reason: 'no_agent' });
  });
  it('no_llm_profile when the agent points at a missing llm profile', () => {
    // Temporarily disable FK constraints to insert an agent referencing a non-existent llm profile
    db.pragma('foreign_keys = OFF');
    seedAgent('does-not-exist');
    db.pragma('foreign_keys = ON');
    expect(resolveAgentReadiness(db)).toEqual({ usable: false, reason: 'no_llm_profile' });
  });
  it('no_credential when the llm profile has no key and no env fallback', () => {
    seedAgent(seedLlm(undefined));
    expect(resolveAgentReadiness(db)).toEqual({ usable: false, reason: 'no_credential' });
  });
  it('usable when the llm profile has an explicit apiKey', () => {
    seedAgent(seedLlm('sk-x'));
    expect(resolveAgentReadiness(db)).toEqual({ usable: true });
  });
  it('usable when a key is available via env even with no stored key', () => {
    seedAgent(seedLlm(undefined));
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    expect(resolveAgentReadiness(db)).toEqual({ usable: true });
  });
});
