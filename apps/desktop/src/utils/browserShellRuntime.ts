export function isBrowserShellRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const protocol = window.location?.protocol;
  return protocol === 'http:' || protocol === 'https:';
}

export function getBrowserShellBaseUrl(): string | null {
  if (!isBrowserShellRuntime()) return null;
  return window.location.origin;
}

export function getBrowserShellFacadeWsUrl(): string | null {
  if (!isBrowserShellRuntime()) return null;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/backend-facade`;
}
