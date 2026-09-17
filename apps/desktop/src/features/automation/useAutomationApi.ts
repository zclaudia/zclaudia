import { useMemo } from 'react';
import { getAuthHeadersForBackend, getBaseUrlForBackend } from '../../services/api/base';

export interface AutomationApi {
  get: (path: string) => Promise<any>;
  post: (path: string, body?: unknown) => Promise<any>;
  patch: (path: string, body?: unknown) => Promise<any>;
  del: (path: string) => Promise<any>;
}

export type AutomationApiType = AutomationApi;

/**
 * Plain (non-hook) client for one backend's automation REST surface. The tabs
 * fan out over every online backend, so they need a client per backend id,
 * not one bound to the active server.
 */
export function createAutomationApi(
  selectedBackendId: string | null,
  fallbackServerUrl = '',
  fallbackAuthToken = ''
): AutomationApi {
  const request = async (path: string, method = 'GET', body?: unknown): Promise<any> => {
    let baseUrl = fallbackServerUrl;
    let authorization = fallbackAuthToken;

    if (selectedBackendId) {
      try {
        baseUrl = getBaseUrlForBackend(selectedBackendId);
      } catch {
        // Fall back to the URL passed at window creation time until facade state is ready.
      }

      try {
        const resolvedAuth =
          (getAuthHeadersForBackend(selectedBackendId) as Record<string, string>)[
            'Authorization'
          ] || '';
        if (resolvedAuth) authorization = resolvedAuth;
      } catch {
        // Same as above — keep fallback auth while the shared registry is still warming up.
      }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authorization) headers.Authorization = authorization;
    const opts: RequestInit = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    if (!baseUrl) throw new Error('No backend connection available');
    const resp = await fetch(`${baseUrl}${path}`, opts);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    if (method === 'DELETE') return;
    const json = await resp.json();
    if (!json.success) throw new Error(json.error?.message || 'Request failed');
    return json.data;
  };

  return {
    get: (path: string) => request(path),
    post: (path: string, body?: unknown) => request(path, 'POST', body),
    patch: (path: string, body?: unknown) => request(path, 'PATCH', body),
    del: (path: string) => request(path, 'DELETE'),
  };
}

export function useAutomationApi(
  selectedBackendId: string | null,
  fallbackServerUrl: string,
  fallbackAuthToken: string
): AutomationApi {
  return useMemo(
    () => createAutomationApi(selectedBackendId, fallbackServerUrl, fallbackAuthToken),
    [selectedBackendId, fallbackServerUrl, fallbackAuthToken]
  );
}
