import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getBrowserShellBaseUrl,
  getBrowserShellFacadeWsUrl,
  isBrowserShellRuntime,
} from '../browserShellRuntime';

function setLocation(url: string): void {
  vi.stubGlobal('location', new URL(url));
  vi.stubGlobal('window', { location: new URL(url) });
}

describe('browserShellRuntime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects an http browser runtime and returns current origin', () => {
    setLocation('http://127.0.0.1:3100/projects');

    expect(isBrowserShellRuntime()).toBe(true);
    expect(getBrowserShellBaseUrl()).toBe('http://127.0.0.1:3100');
    expect(getBrowserShellFacadeWsUrl()).toBe('ws://127.0.0.1:3100/ws/backend-facade');
  });

  it('uses wss for https browser runtime', () => {
    setLocation('https://127.0.0.1:3100/');

    expect(getBrowserShellBaseUrl()).toBe('https://127.0.0.1:3100');
    expect(getBrowserShellFacadeWsUrl()).toBe('wss://127.0.0.1:3100/ws/backend-facade');
  });

  it('does not activate for tauri protocol', () => {
    setLocation('tauri://localhost/');

    expect(isBrowserShellRuntime()).toBe(false);
    expect(getBrowserShellBaseUrl()).toBeNull();
    expect(getBrowserShellFacadeWsUrl()).toBeNull();
  });
});
