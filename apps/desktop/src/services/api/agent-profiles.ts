import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import { apiCall, apiCallVoid } from './unwrap';

const BASE = '/api/agent-profiles';
type AgentProfileWriteInput = Omit<AgentProfileConfig, 'id' | 'createdAt' | 'updatedAt' | 'multimodalFallback'> & {
  multimodalFallback?: AgentProfileConfig['multimodalFallback'] | null;
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

export async function deleteAgentProfile(id: string): Promise<void> {
  return apiCallVoid(`${BASE}/${id}`, { method: 'DELETE' });
}

export async function setDefaultAgentProfile(id: string): Promise<AgentProfileConfig> {
  return apiCall<AgentProfileConfig>(`${BASE}/${id}/set-default`, { method: 'POST' });
}
