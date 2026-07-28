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

  it('agent capabilities: extractText, screenshot, typeText, clickSelector', async () => {
    const session = await engine.createSession({
      onFrame: () => {},
      onState: () => {},
      onCrashed: () => {},
    });
    await session.setViewport({ width: 640, height: 480, dpr: 1 });
    await session.navigate(
      'data:text/html,<title>t3</title><input id="i"><button id="b" onclick="document.title=\'clicked\'">go</button>'
    );
    const text = await session.extractText();
    expect(text.title).toBe('t3');
    const shot = await session.screenshot();
    expect(shot.data.length).toBeGreaterThan(100);
    expect(shot.width).toBe(640);
    expect(await session.clickSelector('#missing')).toBe(false);
    await session.clickSelector('#i');
    await session.typeText('hello', false);
    expect(await session.clickSelector('#b')).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect((await session.extractText()).title).toBe('clicked');
    await session.close();
  }, 30_000);
});
