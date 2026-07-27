import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveChromePath, defaultChromeDiscoveryDeps } from '../chrome-discovery.js';
import { PuppeteerEngine } from '../puppeteer-engine.js';
import type { BrowserPageState } from '@zclaudia/shared';

const chromePath = await resolveChromePath(defaultChromeDiscoveryDeps(join(tmpdir(), 'no-cache')));

describe.skipIf(!chromePath)('PuppeteerEngine (integration, requires Chrome)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zclaudia-browser-test-'));
  const engine = new PuppeteerEngine({ profileDir: join(dir, 'profile'), cacheDir: join(dir, 'cache') });

  afterAll(async () => {
    await engine.dispose();
  });

  it('navigates and reports state + frames', async () => {
    const frames: string[] = [];
    const states: BrowserPageState[] = [];
    const session = await engine.createSession({
      onFrame: (data) => frames.push(data),
      onState: (s) => states.push(s),
      onCrashed: () => {},
    });
    await session.setViewport({ width: 640, height: 480, dpr: 1 });
    await session.startScreencast();
    await session.navigate('data:text/html,<title>hello</title><h1>hi</h1>');
    await new Promise((r) => setTimeout(r, 1500));
    expect(frames.length).toBeGreaterThan(0);
    expect(states.some((s) => s.title === 'hello')).toBe(true);
    await session.close();
  }, 30_000);
});
