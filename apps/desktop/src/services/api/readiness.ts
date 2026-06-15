import { fetchLocalApi } from './base';
import type { AgentReadiness } from '@zclaudia/shared/core/agent-readiness';

export async function getAgentReadiness(): Promise<AgentReadiness> {
  const res = await fetchLocalApi<AgentReadiness>('/api/agent-profiles/readiness');
  // fetchLocalApi returns ApiResponse<T>; fall back to "usable" on a malformed body.
  return res.data ?? { usable: true };
}
