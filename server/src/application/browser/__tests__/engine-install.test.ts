import { describe, it, expect } from 'vitest';
import type { BrowserEngineStatusMessage } from '@zclaudia/shared';
import { installEngine, type EngineInstallDeps } from '../engine-install.js';

describe('installEngine', () => {
  it('emits downloading progress then ready with the executable path', async () => {
    const events: BrowserEngineStatusMessage[] = [];
    const deps: EngineInstallDeps = {
      install: async (onProgress) => {
        onProgress(50, 100);
        onProgress(100, 100);
        return '/cache/chrome/linux-1/chrome';
      },
    };
    await installEngine(deps, (msg) => events.push(msg));
    expect(events.map((e) => e.status)).toEqual(['downloading', 'downloading', 'downloading', 'ready']);
    expect(events[0].progress).toBe(0);
    expect(events[1].progress).toBe(0.5);
    expect(events.at(-1)?.executablePath).toBe('/cache/chrome/linux-1/chrome');
  });

  it('emits error status when the download fails', async () => {
    const events: BrowserEngineStatusMessage[] = [];
    const deps: EngineInstallDeps = {
      install: async () => {
        throw new Error('network down');
      },
    };
    await installEngine(deps, (msg) => events.push(msg));
    expect(events.at(-1)).toMatchObject({ status: 'error', message: 'network down' });
  });

  it('refuses concurrent installs (second call no-ops with no events)', async () => {
    const events: BrowserEngineStatusMessage[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const deps: EngineInstallDeps = {
      install: async () => {
        await gate;
        return '/x';
      },
    };
    const first = installEngine(deps, (msg) => events.push(msg));
    const countAfterFirst = events.length;
    await installEngine(deps, (msg) => events.push(msg));
    expect(events.length).toBe(countAfterFirst); // second call emitted nothing
    release();
    await first;
  });
});
