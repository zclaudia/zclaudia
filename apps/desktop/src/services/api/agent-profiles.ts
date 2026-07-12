import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import { apiCall, apiCallForBackend } from './unwrap';
import { fetchApi, fetchApiForBackend } from './base';

const BASE = '/api/agent-profiles';

/**
 * Structured result for {@link deleteAgentProfileForBackend}. The DELETE route
 * returns `200 {success:true}` on hard-delete, or `200 {success:true, data:{archived,sessionCount}}`
 * when the profile is referenced by active sessions and is converted to read-only
 * instead of being removed. `apiCallVoidForBackend` only resolves on success and
 * drops the `data` payload, so this helper goes straight to `fetchApiForBackend`
 * to preserve the `archived`/`sessionCount` fields the editor branches on.
 */
export type DeleteAgentProfileResult =
  | { ok: true; archived?: boolean; sessionCount?: number }
  | { ok: false; code: string; message: string; sessionCount?: number };
type AgentProfileWriteInput = Omit<
  AgentProfileConfig,
  'id' | 'createdAt' | 'updatedAt' | 'multimodalFallback' | 'cliPath'
> & {
  multimodalFallback?: AgentProfileConfig['multimodalFallback'] | null;
  cliPath?: string | null;
};

export async function listAgentProfiles(options?: RequestInit): Promise<AgentProfileConfig[]> {
  return apiCall<AgentProfileConfig[]>(BASE, options);
}

export async function createAgentProfile(
  input: AgentProfileWriteInput
): Promise<AgentProfileConfig> {
  return apiCall<AgentProfileConfig>(BASE, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateAgentProfile(
  id: string,
  input: Partial<AgentProfileWriteInput>
): Promise<AgentProfileConfig> {
  return apiCall<AgentProfileConfig>(`${BASE}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteAgentProfile(id: string): Promise<DeleteAgentProfileResult> {
  try {
    const response = await fetchApi<unknown>(`${BASE}/${id}`, { method: 'DELETE' });
    if (response.success) {
      const data = response.data as { archived?: boolean; sessionCount?: number } | undefined;
      return { ok: true, archived: data?.archived, sessionCount: data?.sessionCount };
    }
    const err = response.error as { code?: string; message?: string; sessionCount?: number } | undefined;
    return {
      ok: false,
      code: err?.code ?? 'UNKNOWN',
      message: err?.message ?? 'Failed to delete agent profile',
      sessionCount: err?.sessionCount,
    };
  } catch (err) {
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function listAgentProfilesForBackend(
  backendId: string | null
): Promise<AgentProfileConfig[]> {
  return apiCallForBackend<AgentProfileConfig[]>(backendId, BASE);
}

export async function createAgentProfileForBackend(
  backendId: string | null,
  input: AgentProfileWriteInput
): Promise<AgentProfileConfig> {
  return apiCallForBackend<AgentProfileConfig>(backendId, BASE, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateAgentProfileForBackend(
  backendId: string | null,
  id: string,
  input: Partial<AgentProfileWriteInput>
): Promise<AgentProfileConfig> {
  return apiCallForBackend<AgentProfileConfig>(backendId, `${BASE}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteAgentProfileForBackend(
  backendId: string | null,
  id: string
): Promise<DeleteAgentProfileResult> {
  try {
    const response = await fetchApiForBackend<unknown>(`${BASE}/${id}`, backendId, {
      method: 'DELETE',
    });
    if (response.success) {
      const data = response.data as { archived?: boolean; sessionCount?: number } | undefined;
      return { ok: true, archived: data?.archived, sessionCount: data?.sessionCount };
    }
    const err = response.error as
      | { code?: string; message?: string; sessionCount?: number }
      | undefined;
    return {
      ok: false,
      code: err?.code ?? 'UNKNOWN',
      message: err?.message ?? 'Failed to delete agent profile',
      sessionCount: err?.sessionCount,
    };
  } catch (err) {
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function restoreAgentProfileForBackend(
  backendId: string | null,
  id: string
): Promise<AgentProfileConfig> {
  return apiCallForBackend<AgentProfileConfig>(backendId, `${BASE}/${id}/restore`, {
    method: 'POST',
  });
}
