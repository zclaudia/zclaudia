import { describe, it, expect } from 'vitest';
import type { LlmProfileConfig } from '@zclaudia/shared';
import type { ProfileConfigDescriptor } from '@zclaudia/shared/core/profile-config-descriptor';
import { buildDefaultProfilePayload } from './buildDefaultProfilePayload';

const llmDescriptor: ProfileConfigDescriptor = {
  runtime: 'zclaudia',
  label: 'ZClaudia',
  enabled: true,
  model: { kind: 'llm-profile', multimodalFallback: true, thinkingLevel: 'selectable' },
  hasCliPath: false,
  capabilities: { tools: 'profile', providers: 'profile', skills: 'profile' },
};

const noneDescriptor: ProfileConfigDescriptor = {
  ...llmDescriptor,
  runtime: 'claude',
  label: 'Claude',
  model: { kind: 'none', multimodalFallback: false, thinkingLevel: 'auto' },
};

function llm(overrides: Partial<LlmProfileConfig>): LlmProfileConfig {
  return {
    id: 'lp1',
    name: 'Anthropic',
    providerType: 'anthropic',
    models: [{ modelId: 'deepseek-v4-flash' }],
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('buildDefaultProfilePayload', () => {
  it('builds a valid payload for an llm-profile runtime using the default profile and its first model', () => {
    const result = buildDefaultProfilePayload({
      name: '  Coding  ',
      runtimeType: 'zclaudia',
      descriptor: llmDescriptor,
      llmProfiles: [
        llm({ id: 'lp1', isDefault: true, models: [{ modelId: 'deepseek-v4-flash' }] }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.name).toBe('Coding');
    expect(result.payload.runtimeType).toBe('zclaudia');
    expect(result.payload.llmProfileId).toBe('lp1');
    expect(result.payload.model).toBe('deepseek-v4-flash');
    expect(result.payload.systemPrompt).toBe('');
    expect(result.payload.isDefault).toBe(false);
    expect(Array.isArray(result.payload.enabledTools)).toBe(true);
  });

  it('prefers the isDefault profile over the first one', () => {
    const result = buildDefaultProfilePayload({
      name: 'x',
      runtimeType: 'zclaudia',
      descriptor: llmDescriptor,
      llmProfiles: [
        llm({ id: 'lp1', isDefault: false, models: [{ modelId: 'a' }] }),
        llm({ id: 'lp2', isDefault: true, models: [{ modelId: 'b' }] }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.llmProfileId).toBe('lp2');
    expect(result.payload.model).toBe('b');
  });

  it('fails with no-llm-profile when the runtime needs one but none exist', () => {
    const result = buildDefaultProfilePayload({
      name: 'x',
      runtimeType: 'zclaudia',
      descriptor: llmDescriptor,
      llmProfiles: [],
    });
    expect(result).toEqual({ ok: false, reason: 'no-llm-profile' });
  });

  it('fails with no-model when the default profile has no declared models', () => {
    const result = buildDefaultProfilePayload({
      name: 'x',
      runtimeType: 'zclaudia',
      descriptor: llmDescriptor,
      llmProfiles: [llm({ id: 'lp1', isDefault: true, models: [] })],
    });
    expect(result).toEqual({ ok: false, reason: 'no-model' });
  });

  it('builds an empty-model payload for a runtime whose model kind is none', () => {
    const result = buildDefaultProfilePayload({
      name: 'x',
      runtimeType: 'claude',
      descriptor: noneDescriptor,
      llmProfiles: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.model).toBe('');
    expect(result.payload.llmProfileId).toBe('');
  });
});
