import { apiCall, apiCallForBackend } from './unwrap';
import { useOwnershipStore } from '../../stores/ownershipStore';

function getBackendIdForProject(projectId: string): string | null {
  return useOwnershipStore.getState().getProjectBackendId(projectId);
}

export async function getProjectMemoryDir(params: {
  projectId: string;
  backendId?: string | null;
}): Promise<{ memoryDir: string }> {
  const url = `/api/projects/${params.projectId}/memory-dir`;
  const backendId = params.backendId ?? getBackendIdForProject(params.projectId);
  return backendId
    ? apiCallForBackend<{ memoryDir: string }>(backendId, url)
    : apiCall<{ memoryDir: string }>(url);
}
