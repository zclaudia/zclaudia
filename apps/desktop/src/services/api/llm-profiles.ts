import type { LlmProfileConfig, LlmProfileCompat, LlmProfileModelEntry, ProviderCapabilities, SlashCommand } from '@zclaudia/shared';
import { fetchApi, fetchLocalApi, activeServerSupports } from './base';
import { apiCall, apiCallVoid } from './unwrap';

export type FetchLlmProfileModelsResult =
  | { ok: true; models: string[] }
  | { ok: false; error: string };

export type ProbeLlmProfileModelResult =
  | { ok: true; latencyMs: number }
  | { ok: false; error: string };

export async function listLlmProfiles(options?: RequestInit): Promise<LlmProfileConfig[]> {
  return apiCall<LlmProfileConfig[]>('/api/llm-profiles', options);
}

export async function createLlmProfile(data: {
  name: string;
  providerType?: string;
  baseUrl?: string;
  apiKey?: string;
  compat?: LlmProfileCompat;
  env?: Record<string, string>;
  requestHeaders?: Record<string, string>;
  models?: LlmProfileModelEntry[];
  isDefault?: boolean;
}): Promise<LlmProfileConfig> {
  return apiCall<LlmProfileConfig>('/api/llm-profiles', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateLlmProfile(
  id: string,
  data: Partial<LlmProfileConfig>
): Promise<void> {
  return apiCallVoid(`/api/llm-profiles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function deleteLlmProfile(id: string): Promise<void> {
  return apiCallVoid(`/api/llm-profiles/${id}`, { method: 'DELETE' });
}

export async function setDefaultLlmProfile(id: string): Promise<void> {
  if (!activeServerSupports('setDefaultProvider')) {
    console.warn('[API] setDefaultLlmProfile not supported by active server, skipping');
    return;
  }
  return apiCallVoid(`/api/llm-profiles/${id}/set-default`, { method: 'POST' });
}

/**
 * Pre-save form snapshot passed to the preview endpoints. Mirrors the subset
 * of {@link LlmProfileConfig} that `buildPreviewProfile` on the server reads —
 * we deliberately don't send `id`/`name`/`createdAt`/`updatedAt` so the form
 * can fetch / test before the profile has ever been persisted.
 */
export interface LlmProfilePreviewInput {
  providerType: string;
  baseUrl?: string;
  apiKey?: string;
  requestHeaders?: Record<string, string>;
  models?: LlmProfileModelEntry[];
}

/**
 * Discover model ids using the current (possibly unsaved) form draft rather
 * than a persisted profile id. Used by the LLM profile editor so Fetch works
 * for brand-new profiles and reflects baseUrl/apiKey edits without saving.
 */
export async function fetchModelsForLlmProfilePreview(
  profile: LlmProfilePreviewInput,
): Promise<FetchLlmProfileModelsResult> {
  try {
    const data = await apiCall<{ models: string[] }>(`/api/llm-profiles/models/fetch-preview`, {
      method: 'POST',
      body: JSON.stringify(profile),
    });
    return { ok: true, models: Array.isArray(data?.models) ? data.models : [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Probe a (formDraft, modelId) pair against an upstream provider. Returns the
 * same `{ ok, latencyMs }` / `{ ok: false, error }` envelope on both transport
 * failure and server-reported probe failure.
 */
export async function probeLlmProfileModelPreview(
  profile: LlmProfilePreviewInput,
  modelId: string,
): Promise<ProbeLlmProfileModelResult> {
  try {
    const data = await apiCall<ProbeLlmProfileModelResult>(`/api/llm-profiles/models/probe-preview`, {
      method: 'POST',
      body: JSON.stringify({ ...profile, modelId }),
    });
    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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
