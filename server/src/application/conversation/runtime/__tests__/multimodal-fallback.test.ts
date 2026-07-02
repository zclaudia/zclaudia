import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { LlmProfileRepository } from '../../../../domains/llm-profiles/repository.js';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import { resolveMultimodalFallbackForRun } from '../multimodal-fallback.js';

function agent(overrides: Partial<AgentProfileConfig> = {}): AgentProfileConfig {
  return {
    id: 'agent-1',
    name: 'Agent',
    llmProfileId: 'primary',
    model: 'primary-text',
    systemPrompt: '',
    enabledTools: ['read'],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('resolveMultimodalFallbackForRun', () => {
  let db: Database.Database;
  let llmRepo: LlmProfileRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    llmRepo = new LlmProfileRepository(db);
  });

  it('keeps text-only current input on the primary profile and model', () => {
    const primary = llmRepo.create({
      name: 'Primary',
      providerType: 'openai',
      baseUrl: 'http://primary/v1',
      models: [{ modelId: 'primary-text', inputModalities: ['text'] }],
    });
    const fallback = llmRepo.create({
      name: 'Vision',
      providerType: 'openai',
      baseUrl: 'http://vision/v1',
      models: [{ modelId: 'vision-model', inputModalities: ['text', 'image'] }],
    });
    const primaryAgent = agent({
      llmProfileId: primary.id,
      multimodalFallback: { llmProfileId: fallback.id, model: 'vision-model' },
    });

    const resolved = resolveMultimodalFallbackForRun({
      db,
      agentProfile: primaryAgent,
      llmProfile: primary,
      images: [],
    });

    expect(resolved.applied).toBe(false);
    expect(resolved.agentProfile.model).toBe('primary-text');
    expect(resolved.llmProfile.id).toBe(primary.id);
  });

  it('keeps image input on the primary model when it already supports image', () => {
    const primary = llmRepo.create({
      name: 'Primary',
      providerType: 'openai',
      baseUrl: 'http://primary/v1',
      models: [{ modelId: 'primary-vision', inputModalities: ['text', 'image'] }],
    });
    const primaryAgent = agent({
      llmProfileId: primary.id,
      model: 'primary-vision',
    });

    const resolved = resolveMultimodalFallbackForRun({
      db,
      agentProfile: primaryAgent,
      llmProfile: primary,
      images: [{ name: 'a.png', mimeType: 'image/png', data: 'abc' }],
    });

    expect(resolved.applied).toBe(false);
    expect(resolved.agentProfile.model).toBe('primary-vision');
    expect(resolved.llmProfile.id).toBe(primary.id);
  });

  it('switches image input to the configured cross-profile fallback', () => {
    const primary = llmRepo.create({
      name: 'Primary',
      providerType: 'openai',
      baseUrl: 'http://primary/v1',
      models: [{ modelId: 'primary-text', inputModalities: ['text'] }],
    });
    const fallback = llmRepo.create({
      name: 'Vision',
      providerType: 'openai',
      baseUrl: 'http://vision/v1',
      models: [{ modelId: 'vision-model', inputModalities: ['text', 'image'] }],
    });
    const primaryAgent = agent({
      llmProfileId: primary.id,
      multimodalFallback: { llmProfileId: fallback.id, model: 'vision-model' },
    });

    const resolved = resolveMultimodalFallbackForRun({
      db,
      agentProfile: primaryAgent,
      llmProfile: primary,
      images: [{ name: 'a.png', mimeType: 'image/png', data: 'abc' }],
    });

    expect(resolved.applied).toBe(true);
    expect(resolved.agentProfile).toEqual(
      expect.objectContaining({
        id: primaryAgent.id,
        model: 'vision-model',
        llmProfileId: fallback.id,
      })
    );
    expect(resolved.llmProfile.id).toBe(fallback.id);
    expect(resolved.llmProfileId).toBe(fallback.id);
    expect(resolved.providerType).toBe('openai');
  });

  it('preserves existing no-fallback behavior by returning the primary profile', () => {
    const primary = llmRepo.create({
      name: 'Primary',
      providerType: 'openai',
      baseUrl: 'http://primary/v1',
      models: [{ modelId: 'primary-text', inputModalities: ['text'] }],
    });

    const resolved = resolveMultimodalFallbackForRun({
      db,
      agentProfile: agent({ llmProfileId: primary.id }),
      llmProfile: primary,
      images: [{ name: 'a.png', mimeType: 'image/png', data: 'abc' }],
    });

    expect(resolved.applied).toBe(false);
    expect(resolved.agentProfile.model).toBe('primary-text');
    expect(resolved.llmProfile.id).toBe(primary.id);
  });

  it('throws before provider launch when configured fallback is not vision-capable', () => {
    const primary = llmRepo.create({
      name: 'Primary',
      providerType: 'openai',
      baseUrl: 'http://primary/v1',
      models: [{ modelId: 'primary-text', inputModalities: ['text'] }],
    });
    const fallback = llmRepo.create({
      name: 'Text fallback',
      providerType: 'openai',
      baseUrl: 'http://fallback/v1',
      models: [{ modelId: 'fallback-text', inputModalities: ['text'] }],
    });

    expect(() =>
      resolveMultimodalFallbackForRun({
        db,
        agentProfile: agent({
          llmProfileId: primary.id,
          multimodalFallback: { llmProfileId: fallback.id, model: 'fallback-text' },
        }),
        llmProfile: primary,
        images: [{ name: 'a.png', mimeType: 'image/png', data: 'abc' }],
      })
    ).toThrow(/does not support image input/i);
  });
});
