import type {
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

/** Every language-server instance on the backend, plus the master switch. */
export async function getLanguageServers(
  backendId?: string | null
): Promise<LanguageServersOverview> {
  return apiCallForBackend<LanguageServersOverview>(backendId, '/api/language-servers');
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
