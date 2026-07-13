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

function setTauriLocation(url: string): void {
  vi.stubGlobal('location', new URL(url));
  vi.stubGlobal('window', { location: new URL(url), __TAURI_INTERNALS__: {} });
}

describe('browserShellRuntime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects an http browser runtime and returns current origin', () => {
    setLocation('http://127.0.0.1:3100/projects');

    expect(isBrowserShellRuntime({ PROD: true })).toBe(true);
    expect(getBrowserShellBaseUrl({ PROD: true })).toBe('http://127.0.0.1:3100');
    expect(getBrowserShellFacadeWsUrl({ PROD: true })).toBe('ws://127.0.0.1:3100/ws/backend-facade');
  });

  it('uses wss for https browser runtime', () => {
    setLocation('https://127.0.0.1:3100/');

    expect(isBrowserShellRuntime({ PROD: true })).toBe(true);
    expect(getBrowserShellBaseUrl({ PROD: true })).toBe('https://127.0.0.1:3100');
    expect(getBrowserShellFacadeWsUrl({ PROD: true })).toBe('wss://127.0.0.1:3100/ws/backend-facade');
  });

  it('does not activate for vite dev http pages', () => {
    setLocation('http://127.0.0.1:1420/');

    expect(isBrowserShellRuntime({ PROD: false })).toBe(false);
    expect(getBrowserShellBaseUrl()).toBeNull();
    expect(getBrowserShellFacadeWsUrl()).toBeNull();
  });

  it('does not activate for tauri protocol', () => {
    setLocation('tauri://localhost/');

    expect(isBrowserShellRuntime()).toBe(false);
    expect(getBrowserShellBaseUrl()).toBeNull();
    expect(getBrowserShellFacadeWsUrl()).toBeNull();
  });

  it('does not activate for tauri dev http pages', () => {
    setTauriLocation('http://127.0.0.1:1420/');

    expect(isBrowserShellRuntime()).toBe(false);
    expect(getBrowserShellBaseUrl()).toBeNull();
    expect(getBrowserShellFacadeWsUrl()).toBeNull();
  });
});
