import type {
  CustomLanguageServers,
  FileLanguageServerDiagnostics,
  LanguageServerViewerLease,
  LanguageServerConfig,
  LanguageServersOverview,
  SessionLanguageServers,
} from '@zclaudia/shared/core/language-servers';
import { apiCall, apiCallForBackend } from './unwrap';

/** Language servers one session's agent can use (composer indicator). */
export async function getSessionLanguageServers(
  sessionId: string
): Promise<SessionLanguageServers> {
  return apiCall<SessionLanguageServers>(
    `/api/language-servers/sessions/${encodeURIComponent(sessionId)}`
  );
}

/**
 * Every language-server instance on the backend, plus the master switch.
 * `refresh` re-probes installed servers now instead of after the cache TTL.
 */
export async function getLanguageServers(
  backendId?: string | null,
  options: { refresh?: boolean } = {}
): Promise<LanguageServersOverview> {
  return apiCallForBackend<LanguageServersOverview>(
    backendId,
    `/api/language-servers${options.refresh ? '?refresh=1' : ''}`
  );
}

export async function setLanguageServersEnabled(
  enabled: boolean,
  backendId?: string | null
): Promise<LanguageServersOverview> {
  return apiCallForBackend<LanguageServersOverview>(backendId, '/api/language-servers', {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}

/** The user's own server definitions on the backend. */
export async function getCustomLanguageServers(
  backendId?: string | null
): Promise<CustomLanguageServers> {
  return apiCallForBackend<CustomLanguageServers>(backendId, '/api/language-servers/custom');
}

/** Replace the user's server definitions (validated by the backend). */
export async function setCustomLanguageServers(
  servers: LanguageServerConfig[],
  backendId?: string | null
): Promise<CustomLanguageServers> {
  return apiCallForBackend<CustomLanguageServers>(backendId, '/api/language-servers/custom', {
    method: 'PUT',
    body: JSON.stringify({ servers }),
  });
}

/** Let a plugin run commands, which its language servers need. */
export async function allowPluginLanguageServers(
  pluginId: string,
  backendId?: string | null
): Promise<void> {
  await apiCallForBackend<unknown>(
    backendId,
    `/api/plugins/${encodeURIComponent(pluginId)}/permissions/grant`,
    { method: 'POST', body: JSON.stringify({ permissions: ['shell.execute'] }) }
  );
}

/** A file's diagnostics, only from a language server that is already running. */
export async function getFileLanguageServerDiagnostics(params: {
  projectRoot: string;
  relativePath: string;
  backendId?: string | null;
}): Promise<FileLanguageServerDiagnostics> {
  const query = new URLSearchParams({ root: params.projectRoot, path: params.relativePath });
  return apiCallForBackend<FileLanguageServerDiagnostics>(
    params.backendId,
    `/api/language-servers/file-diagnostics?${query.toString()}`
  );
}

/** Start (and keep running) a workspace's language servers for a file viewer. */
export async function acquireLanguageServerViewerLease(
  projectRoot: string,
  backendId?: string | null
): Promise<LanguageServerViewerLease> {
  return apiCallForBackend<LanguageServerViewerLease>(
    backendId,
    '/api/language-servers/viewer-leases',
    { method: 'POST', body: JSON.stringify({ root: projectRoot }) }
  );
}

export async function renewLanguageServerViewerLease(
  leaseId: string,
  backendId?: string | null
): Promise<LanguageServerViewerLease> {
  return apiCallForBackend<LanguageServerViewerLease>(
    backendId,
    `/api/language-servers/viewer-leases/${encodeURIComponent(leaseId)}/renew`,
    { method: 'POST' }
  );
}

export async function releaseLanguageServerViewerLease(
  leaseId: string,
  backendId?: string | null
): Promise<void> {
  await apiCallForBackend<unknown>(
    backendId,
    `/api/language-servers/viewer-leases/${encodeURIComponent(leaseId)}`,
    { method: 'DELETE' }
  );
}
