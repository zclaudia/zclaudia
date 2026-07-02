import type { ContextGraph } from '@zclaudia/shared';
import { apiCall, apiCallForBackend } from './unwrap';
import { useOwnershipStore } from '../../stores/ownershipStore';

/**
 * Fetch the fork-family context graph for a session (SP-B read endpoint).
 * Routes to the session's owner backend; falls back to the default backend
 * when ownership is unknown (e.g. local-only).
 */
export async function fetchContextGraph(sessionId: string): Promise<ContextGraph> {
  const url = `/api/sessions/${sessionId}/context-graph`;
  const backendId = useOwnershipStore.getState().getSessionBackendId(sessionId);
  return backendId ? apiCallForBackend<ContextGraph>(backendId, url) : apiCall<ContextGraph>(url);
}
