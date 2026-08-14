import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveChromePath, defaultChromeDiscoveryDeps } from '../chrome-discovery.js';
import { PuppeteerEngine } from '../puppeteer-engine.js';
import type {
  BrowserConsoleEntry,
  BrowserNetworkEntry,
  BrowserPageState,
  BrowserPickedElement,
} from '@zclaudia/shared';

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
      onNetwork: () => {},
      onNetworkReset: () => {},
      onElementPicked: () => {},
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
      onNetwork: () => {},
      onNetworkReset: () => {},
      onElementPicked: () => {},
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
      onNetwork: () => {},
      onNetworkReset: () => {},
      onElementPicked: () => {},
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
      onNetwork: () => {},
      onNetworkReset: () => {},
      onElementPicked: () => {},
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

  it('tracks network requests through their lifecycle and resets on navigation', async () => {
    const server: Server = createServer((req, res) => {
      if (req.url === '/page') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<title>net</title><script>fetch("/ok");fetch("/missing")</script>');
      } else if (req.url === '/ok') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      } else {
        res.writeHead(404);
        res.end('nope');
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const entries = new Map<string, BrowserNetworkEntry>();
    let resets = 0;
    const session = await engine.createSession({
      onFrame: () => {},
      onState: () => {},
      onCrashed: () => {},
      onConsole: () => {},
      onConsoleReset: () => {},
      onNetwork: (e) => entries.set(e.id, e),
      onNetworkReset: () => resets++,
      onElementPicked: () => {},
    });
    try {
      await session.navigate(`${base}/page`);
      await new Promise((r) => setTimeout(r, 800));
      const byPath = (path: string) => [...entries.values()].find((e) => e.url === `${base}${path}`);
      expect(resets).toBe(1); // main-frame navigation cleared before its own entry
      expect(byPath('/page')).toMatchObject({ method: 'GET', resourceType: 'document', status: 200 });
      expect(byPath('/ok')).toMatchObject({ status: 200, contentType: 'application/json' });
      expect(byPath('/missing')).toMatchObject({ status: 404 });
      expect(byPath('/ok')?.durationMs).toBeGreaterThanOrEqual(0);

      await session.navigate(`${base}/page`);
      await new Promise((r) => setTimeout(r, 300));
      expect(resets).toBe(2);
    } finally {
      await session.close();
      await new Promise((r) => server.close(r));
    }
  }, 30_000);

  it('inspect mode: a click picks the element under the cursor and reports a selector + outerHTML', async () => {
    const picked: BrowserPickedElement[] = [];
    const session = await engine.createSession({
      onFrame: () => {},
      onState: () => {},
      onCrashed: () => {},
      onConsole: () => {},
      onConsoleReset: () => {},
      onNetwork: () => {},
      onNetworkReset: () => {},
      onElementPicked: (el) => picked.push(el),
    });
    await session.setViewport({ width: 640, height: 480, dpr: 1 });
    await session.navigate(
      'data:text/html,<title>pick</title><body style="margin:0"><button id="target" class="cta" style="position:absolute;left:0;top:0;width:200px;height:100px">Save changes</button></body>'
    );
    await session.setInspectMode(true);
    // Overlay inspect mode intercepts the click and fires inspectNodeRequested
    // instead of delivering it to the page.
    await session.dispatchInput({ kind: 'mouse', type: 'move', x: 50, y: 40 });
    await session.dispatchInput({ kind: 'mouse', type: 'down', x: 50, y: 40, button: 'left', clickCount: 1 });
    await session.dispatchInput({ kind: 'mouse', type: 'up', x: 50, y: 40, button: 'left', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 800));
    expect(picked).toHaveLength(1);
    expect(picked[0].selector).toBe('#target');
    expect(picked[0].tag).toBe('button');
    expect(picked[0].classes).toContain('cta');
    expect(picked[0].text).toBe('Save changes');
    expect(picked[0].outerHtml).toContain('id="target"');
    await session.close();
  }, 30_000);
});
