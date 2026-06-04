import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchModelsForProfile } from '../models-fetch.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

describe('fetchModelsForProfile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('hits anthropic /v1/models with x-api-key + anthropic-version headers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'claude-opus-4-7' }, { id: 'claude-sonnet-4-6' }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    const profile: LlmProfileConfig = {
      id: 'p', name: 'a', providerType: 'anthropic', apiKey: 'sk-x',
      createdAt: 0, updatedAt: 0,
    };
    const result = await fetchModelsForProfile(profile);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.models).toEqual(['claude-opus-4-7', 'claude-sonnet-4-6']);
    }
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'sk-x',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
  });

  it('hits openai /v1/models with Authorization: Bearer', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'gpt-5' }, { id: 'gpt-4o' }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    const profile: LlmProfileConfig = {
      id: 'p', name: 'o', providerType: 'openai', apiKey: 'sk-x',
      createdAt: 0, updatedAt: 0,
    };
    const result = await fetchModelsForProfile(profile);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.models).toEqual(['gpt-4o', 'gpt-5']);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-x' }),
      }),
    );
  });

  it('uses profile.baseUrl when set (openai-custom)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'local-model' }] }), { status: 200 }),
    );
    const profile: LlmProfileConfig = {
      id: 'p', name: 'c', providerType: 'openai-custom',
      baseUrl: 'http://my-host.local/v1', apiKey: 'k', createdAt: 0, updatedAt: 0,
    };
    const result = await fetchModelsForProfile(profile);
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://my-host.local/v1/models',
      expect.anything(),
    );
  });

  it('returns ok=false on non-200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Forbidden', { status: 403 }));
    const profile: LlmProfileConfig = {
      id: 'p', name: 'a', providerType: 'anthropic', apiKey: 'sk-x',
      createdAt: 0, updatedAt: 0,
    };
    const result = await fetchModelsForProfile(profile);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('403');
  });

  it('returns ok=false when openai-custom has no baseUrl', async () => {
    const profile: LlmProfileConfig = {
      id: 'p', name: 'c', providerType: 'openai-custom', apiKey: 'k', createdAt: 0, updatedAt: 0,
    };
    const result = await fetchModelsForProfile(profile);
    expect(result.ok).toBe(false);
  });

  it('merges profile.requestHeaders into the outgoing request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'm' }] }), { status: 200 }),
    );
    const profile: LlmProfileConfig = {
      id: 'p', name: 'a', providerType: 'anthropic', apiKey: 'sk-x',
      requestHeaders: { 'X-Custom': 'yes' },
      createdAt: 0, updatedAt: 0,
    };
    await fetchModelsForProfile(profile);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Custom': 'yes', 'x-api-key': 'sk-x' }),
      }),
    );
  });
});
