type BrowserShellEnv = Pick<ImportMetaEnv, 'PROD'>;

export function isBrowserShellRuntime(env: BrowserShellEnv = import.meta.env): boolean {
  if (typeof window === 'undefined') return false;
  if ('__TAURI_INTERNALS__' in window) return false;
  if (!env.PROD) return false;
  const protocol = window.location?.protocol;
  return protocol === 'http:' || protocol === 'https:';
}

export function getBrowserShellBaseUrl(env: BrowserShellEnv = import.meta.env): string | null {
  if (!isBrowserShellRuntime(env)) return null;
  return window.location.origin;
}

export function getBrowserShellFacadeWsUrl(env: BrowserShellEnv = import.meta.env): string | null {
  if (!isBrowserShellRuntime(env)) return null;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/backend-facade`;
}
