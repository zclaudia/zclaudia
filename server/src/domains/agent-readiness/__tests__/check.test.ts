import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { AgentProfileRepository } from '../../agent-profiles/repository.js';
import { LlmProfileRepository } from '../../llm-profiles/repository.js';
import { resolveAgentReadiness } from '../check.js';
import { registerClaudeTestRuntime } from '../../../test/claude-runtime-fixture.js';

// The claude runtime ships as a plugin; simulate it being active so its native
// (no-llm-profile) readiness path is exercised.
registerClaudeTestRuntime();

let db: Database.Database;
const SAVED: Record<string, string | undefined> = {};
const ENV = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_BASE_URL'];

beforeEach(() => {
  for (const k of ENV) {
    SAVED[k] = process.env[k];
    delete process.env[k];
  }
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
});

afterEach(() => {
  db.close();
  for (const k of ENV) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

function seedLlm(apiKey?: string, models?: { modelId: string }[]): string {
  const llmRepo = new LlmProfileRepository(db);
  const lp = llmRepo.create({
    name: 'test-llm',
    providerType: 'anthropic',
    apiKey,
    isDefault: true,
    models,
  });
  return lp.id;
}

function seedAgent(llmProfileId: string, model = 'claude-sonnet-4-6') {
  const agentRepo = new AgentProfileRepository(db);
  agentRepo.create({
    name: 'test-agent',
    llmProfileId,
    model,
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
  it('NOT usable when only an env key is set (no profile key)', () => {
    seedAgent(seedLlm(undefined));
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    expect(resolveAgentReadiness(db)).toEqual({ usable: false, reason: 'no_credential' });
  });

  it('no_model when the agent model is blank even though a credential exists', () => {
    seedAgent(seedLlm('sk-x'), '');
    expect(resolveAgentReadiness(db)).toEqual({ usable: false, reason: 'no_model' });
  });
  it('no_model when the profile declares models and the agent model is not among them', () => {
    // openai/kimi-style profile that only serves kimi-k2.6, but the agent still
    // points at a Claude id the endpoint will reject.
    seedAgent(seedLlm('sk-x', [{ modelId: 'kimi-k2.6' }]), 'claude-sonnet-4-6');
    expect(resolveAgentReadiness(db)).toEqual({ usable: false, reason: 'no_model' });
  });
  it('usable when the agent model is among the profile declared models', () => {
    seedAgent(seedLlm('sk-x', [{ modelId: 'kimi-k2.6' }]), 'kimi-k2.6');
    expect(resolveAgentReadiness(db)).toEqual({ usable: true });
  });
  it('usable when the profile declares no models but the model exists in the registry', () => {
    seedAgent(seedLlm('sk-x'), 'claude-sonnet-4-6');
    expect(resolveAgentReadiness(db)).toEqual({ usable: true });
  });
  it('no_model when the profile declares no models and the model is not in the registry', () => {
    seedAgent(seedLlm('sk-x'), 'totally-unregistered-model-id');
    expect(resolveAgentReadiness(db)).toEqual({ usable: false, reason: 'no_model' });
  });

  it('usable for a native (claude) runtime with a model and no llm profile', () => {
    const agentRepo = new AgentProfileRepository(db);
    agentRepo.create({
      name: 'claude-agent',
      llmProfileId: '',
      model: 'claude-opus-4-8',
      systemPrompt: '',
      enabledTools: [],
      runtimeType: 'claude',
      isDefault: true,
    });
    expect(resolveAgentReadiness(db)).toEqual({ usable: true });
  });

  it('usable for a native runtime using the CLI default model', () => {
    const agentRepo = new AgentProfileRepository(db);
    agentRepo.create({
      name: 'claude-agent',
      llmProfileId: '',
      model: '',
      systemPrompt: '',
      enabledTools: [],
      runtimeType: 'claude',
      isDefault: true,
    });
    expect(resolveAgentReadiness(db)).toEqual({ usable: true });
  });
});
