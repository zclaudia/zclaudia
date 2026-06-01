import type { LlmProfileConfig, LlmProfileCompat, ProviderCapabilities, SlashCommand } from '@zclaudia/shared';
import { fetchApi, fetchLocalApi, activeServerSupports } from './base';
import { apiCall, apiCallVoid } from './unwrap';

export async function getProviders(options?: RequestInit): Promise<LlmProfileConfig[]> {
  return apiCall<LlmProfileConfig[]>('/api/llm-profiles', options);
}

export async function createProvider(data: {
  name: string;
  providerType?: string;
  baseUrl?: string;
  apiKey?: string;
  compat?: LlmProfileCompat;
  env?: Record<string, string>;
  isDefault?: boolean;
}): Promise<LlmProfileConfig> {
  return apiCall<LlmProfileConfig>('/api/llm-profiles', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateProvider(
  id: string,
  data: Partial<LlmProfileConfig>
): Promise<void> {
  return apiCallVoid(`/api/llm-profiles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function deleteProvider(id: string): Promise<void> {
  return apiCallVoid(`/api/llm-profiles/${id}`, { method: 'DELETE' });
}

export async function setDefaultProvider(id: string): Promise<void> {
  if (!activeServerSupports('setDefaultProvider')) {
    console.warn('[API] setDefaultProvider not supported by active server, skipping');
    return;
  }
  return apiCallVoid(`/api/llm-profiles/${id}/set-default`, { method: 'POST' });
}

// Runtime adapter capability/command routes stay under `/api/providers` —
// they describe the runtime shell, not the LLM connection profile.

export async function getProviderCommands(
  llmProfileId: string,
  projectRoot?: string,
  options?: RequestInit
): Promise<SlashCommand[]> {
  const query = projectRoot ? `?projectRoot=${encodeURIComponent(projectRoot)}` : '';
  if (activeServerSupports('providerCommands')) {
    const result = await fetchApi<SlashCommand[]>(`/api/providers/${llmProfileId}/commands${query}`, options);
    if (result.success && result.data) return result.data;
  }
  const localResult = await fetchLocalApi<SlashCommand[]>(`/api/providers/type/zclaudia/commands${query}`);
  if (!localResult.success || !localResult.data) {
    throw new Error(localResult.error?.message || 'Failed to fetch provider commands');
  }
  return localResult.data;
}

export async function getProviderTypeCommands(
  providerType: string,
  projectRoot?: string,
  options?: RequestInit
): Promise<SlashCommand[]> {
  const query = projectRoot ? `?projectRoot=${encodeURIComponent(projectRoot)}` : '';
  if (activeServerSupports('providerCommands')) {
    const result = await fetchApi<SlashCommand[]>(`/api/providers/type/${providerType}/commands${query}`, options);
    if (result.success && result.data) return result.data;
  }
  const localResult = await fetchLocalApi<SlashCommand[]>(`/api/providers/type/${providerType}/commands${query}`);
  if (!localResult.success || !localResult.data) {
    throw new Error(localResult.error?.message || 'Failed to fetch provider type commands');
  }
  return localResult.data;
}

export async function getProviderCapabilities(
  llmProfileId: string,
  options?: RequestInit
): Promise<ProviderCapabilities> {
  if (activeServerSupports('providerCapabilities')) {
    const result = await fetchApi<ProviderCapabilities>(`/api/providers/${llmProfileId}/capabilities`, options);
    if (result.success && result.data) return result.data;
  }
  const localResult = await fetchLocalApi<ProviderCapabilities>(`/api/providers/type/zclaudia/capabilities`);
  if (!localResult.success || !localResult.data) {
    throw new Error(localResult.error?.message || 'Failed to fetch provider capabilities');
  }
  return localResult.data;
}

export async function getProviderTypeCapabilities(
  providerType: string,
  options?: RequestInit
): Promise<ProviderCapabilities> {
  if (activeServerSupports('providerCapabilities')) {
    const result = await fetchApi<ProviderCapabilities>(`/api/providers/type/${providerType}/capabilities`, options);
    if (result.success && result.data) return result.data;
  }
  const localResult = await fetchLocalApi<ProviderCapabilities>(`/api/providers/type/${providerType}/capabilities`);
  if (!localResult.success || !localResult.data) {
    throw new Error(localResult.error?.message || 'Failed to fetch provider type capabilities');
  }
  return localResult.data;
}
