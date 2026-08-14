import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveChromePath, defaultChromeDiscoveryDeps } from '../chrome-discovery.js';
import { PuppeteerEngine } from '../puppeteer-engine.js';
import type { BrowserConsoleEntry, BrowserPageState } from '@zclaudia/shared';

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
      onConsole: () => {},
      onConsoleReset: () => {},
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
      onConsole: () => {},
      onConsoleReset: () => {},
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

  it('device emulation applies UA + viewport (with auto-reload) and restores defaults on disable', async () => {
    const session = await engine.createSession({
      onFrame: () => {},
      onState: () => {},
      onCrashed: () => {},
      onConsole: () => {},
      onConsoleReset: () => {},
    });
    await session.setViewport({ width: 640, height: 480, dpr: 1 });
    // Title tracks the UA + layout width at load time, so the auto-reload
    // inside setEmulation is what must surface the new values. The viewport
    // meta matters: without it, isMobile renders the classic 980px layout.
    await session.navigate(
      'data:text/html,<meta name="viewport" content="width=device-width"><script>document.title=navigator.userAgent+" w"+innerWidth</script>'
    );
    await session.setEmulation(
      { presetId: 'test', width: 393, height: 852, dpr: 2, userAgent: 'zclaudia-test-ua', mobile: true, hasTouch: true },
      { width: 640, height: 480, dpr: 1 }
    );
    let text = await session.extractText();
    expect(text.title).toContain('zclaudia-test-ua');
    expect(text.title).toContain('w393');
    const shot = await session.screenshot();
    expect(shot.width).toBe(393);
    expect(shot.height).toBe(852);
    await session.setEmulation(null, { width: 640, height: 480, dpr: 1 });
    text = await session.extractText();
    expect(text.title).not.toContain('zclaudia-test-ua');
    expect(text.title).toContain('w640');
    await session.close();
  }, 30_000);

  it('forwards console messages and page errors, and resets on navigation', async () => {
    const entries: BrowserConsoleEntry[] = [];
    let resets = 0;
    const session = await engine.createSession({
      onFrame: () => {},
      onState: () => {},
      onCrashed: () => {},
      onConsole: (e) => entries.push(e),
      onConsoleReset: () => resets++,
    });
    await session.navigate(
      'data:text/html,<script>console.log("plain log");console.warn("warned");throw new Error("kaboom")</script>'
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(entries.some((e) => e.level === 'log' && e.text === 'plain log')).toBe(true);
    expect(entries.some((e) => e.level === 'warn' && e.text === 'warned')).toBe(true);
    expect(entries.some((e) => e.level === 'error' && e.text.includes('kaboom'))).toBe(true);
    expect(resets).toBeGreaterThan(0);
    await session.close();
  }, 30_000);
});
