import { apiCall, apiCallForBackend } from './unwrap';

export async function getProjectMemoryDir(params: {
  projectId: string;
  backendId?: string | null;
}): Promise<{ memoryDir: string }> {
  const url = `/api/projects/${params.projectId}/memory-dir`;
  return params.backendId
    ? apiCallForBackend<{ memoryDir: string }>(params.backendId, url)
    : apiCall<{ memoryDir: string }>(url);
}
