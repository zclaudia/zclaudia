import type { Browser, CDPSession, Page } from 'puppeteer-core';
import type {
  BrowserConsoleEntry,
  BrowserDeviceEmulation,
  BrowserInputEvent,
  BrowserPageState,
  BrowserViewport,
} from '@zclaudia/shared';
import type { BrowserEngine, EngineSession, EngineSessionCallbacks, EngineStatus } from './engine.js';
import { defaultChromeDiscoveryDeps, resolveChromePath } from './chrome-discovery.js';
import { toCdpInput } from './input-mapping.js';

// Server's tsconfig has no "DOM" lib (Node-only), but page.evaluate() callbacks below
// are serialized and run inside the browser tab. This shape is file-scoped (not global)
// and covers only what extractText() touches.
declare const document: {
  title: string;
  body: { innerText: string } | null;
};

const SCREENCAST_QUALITY = 60;
/**
 * Screencast frames are capped at 2x regardless of the emulated dpr: an
 * iPhone-class 3x device would otherwise stream 1179×2556 JPEGs over JSON.
 * Page rendering keeps the true dpr so media queries and srcset stay accurate.
 */
const SCREENCAST_MAX_DPR = 2;

const CONSOLE_LEVELS: Record<string, BrowserConsoleEntry['level']> = {
  log: 'log',
  info: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  assert: 'error',
  debug: 'debug',
  verbose: 'debug',
};

export class PuppeteerEngine implements BrowserEngine {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private openPages = 0;

  constructor(private opts: { profileDir: string; cacheDir: string }) {}

  async engineStatus(): Promise<EngineStatus> {
    const path = await resolveChromePath(defaultChromeDiscoveryDeps(this.opts.cacheDir));
    return path ? { status: 'ready', executablePath: path } : { status: 'missing' };
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    if (this.launching) return this.launching;
    this.launching = (async () => {
      const status = await this.engineStatus();
      if (status.status !== 'ready' || !status.executablePath) {
        throw new Error('browser engine unavailable');
      }
      const puppeteer = (await import('puppeteer-core')).default;
      const browser = await puppeteer.launch({
        executablePath: status.executablePath,
        headless: true,
        userDataDir: this.opts.profileDir,
        args: ['--no-first-run', '--no-default-browser-check', '--mute-audio'],
      });
      this.browser = browser;
      return browser;
    })();
    try {
      return await this.launching;
    } finally {
      this.launching = null;
    }
  }

  async createSession(callbacks: EngineSessionCallbacks): Promise<EngineSession> {
    const browser = await this.ensureBrowser();
    const page = await browser.newPage();
    this.openPages += 1;
    const cdp = await page.createCDPSession();
    const session = new PuppeteerSession(page, cdp, callbacks, () => this.onPageClosed());
    await session.init();
    return session;
  }

  /** Close Chrome when the last page is gone; relaunch happens lazily. */
  private onPageClosed(): void {
    this.openPages = Math.max(0, this.openPages - 1);
    if (this.openPages === 0 && this.browser) {
      const b = this.browser;
      this.browser = null;
      void b.close().catch(() => {});
    }
  }

  async dispose(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    this.openPages = 0;
    if (b) await b.close().catch(() => {});
  }
}

class PuppeteerSession implements EngineSession {
  private state: BrowserPageState = {
    url: 'about:blank',
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
  };
  private closedByUs = false;
  private viewport: BrowserViewport = { width: 1024, height: 768, dpr: 1 };
  private screencasting = false;
  private emulation: BrowserDeviceEmulation | null = null;
  private defaultUserAgent = '';

  constructor(
    private page: Page,
    private cdp: CDPSession,
    private callbacks: EngineSessionCallbacks,
    private onClosedHook: () => void
  ) {}

  async init(): Promise<void> {
    this.defaultUserAgent = await this.page.browser().userAgent();
    this.page.on('framenavigated', (frame) => {
      if (frame !== this.page.mainFrame()) return;
      this.callbacks.onConsoleReset();
      void this.refreshState({ loading: true });
    });
    this.page.on('console', (msg) => {
      const loc = msg.location();
      this.callbacks.onConsole({
        level: CONSOLE_LEVELS[msg.type()] ?? 'log',
        text: msg.text(),
        ts: Date.now(),
        ...(loc.url ? { location: `${loc.url}:${(loc.lineNumber ?? 0) + 1}` } : {}),
      });
    });
    this.page.on('pageerror', (err) => {
      this.callbacks.onConsole({
        level: 'error',
        text: err instanceof Error ? (err.stack ?? err.message) : String(err),
        ts: Date.now(),
      });
    });
    this.page.on('load', () => void this.refreshState({ loading: false }));
    this.page.on('close', () => {
      this.onClosedHook();
      if (!this.closedByUs) this.callbacks.onCrashed();
    });
    this.cdp.on('Page.screencastFrame', (ev) => {
      this.callbacks.onFrame(ev.data, {
        deviceWidth: ev.metadata.deviceWidth,
        deviceHeight: ev.metadata.deviceHeight,
      });
      void this.cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
    });
  }

  private async refreshState(patch: Partial<BrowserPageState>): Promise<void> {
    try {
      const history = await this.cdp.send('Page.getNavigationHistory');
      this.state = {
        ...this.state,
        ...patch,
        url: this.page.url(),
        title: await this.page.title(),
        canGoBack: history.currentIndex > 0,
        canGoForward: history.currentIndex < history.entries.length - 1,
      };
      this.callbacks.onState(this.state);
    } catch {
      /* page died mid-query; close handler covers it */
    }
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url).catch((err: Error) => {
      void this.refreshState({ loading: false });
      throw err;
    });
  }

  async history(direction: 'back' | 'forward'): Promise<void> {
    if (direction === 'back') await this.page.goBack().catch(() => {});
    else await this.page.goForward().catch(() => {});
  }

  async reload(): Promise<void> {
    await this.page.reload().catch(() => {});
  }

  async stop(): Promise<void> {
    await this.cdp.send('Page.stopLoading').catch(() => {});
  }

  async setViewport(viewport: BrowserViewport): Promise<void> {
    // Emulation pins the logical viewport; a late-arriving panel resize must
    // not clobber it (BrowserManager also guards, this is belt-and-braces).
    if (this.emulation) return;
    await this.applyViewport(viewport, { isMobile: false, hasTouch: false });
  }

  private async applyViewport(
    viewport: BrowserViewport,
    opts: { isMobile: boolean; hasTouch: boolean }
  ): Promise<void> {
    this.viewport = viewport;
    await this.page.setViewport({
      width: Math.max(1, Math.round(viewport.width)),
      height: Math.max(1, Math.round(viewport.height)),
      deviceScaleFactor: viewport.dpr,
      isMobile: opts.isMobile,
      hasTouch: opts.hasTouch,
    });
    if (this.screencasting) {
      // restart screencast so maxWidth/maxHeight track the new size
      await this.stopScreencast();
      await this.startScreencast();
    }
  }

  async setEmulation(
    emulation: BrowserDeviceEmulation | null,
    fallbackViewport: BrowserViewport
  ): Promise<void> {
    this.emulation = emulation;
    if (emulation) {
      await this.page.setUserAgent(emulation.userAgent);
      // Injected mouse events become touch events, so touch-only pages
      // (carousels, mobile menus) respond to panel interaction.
      await this.cdp
        .send('Emulation.setEmitTouchEventsForMouse', { enabled: emulation.hasTouch, configuration: 'mobile' })
        .catch(() => {});
      await this.applyViewport(
        { width: emulation.width, height: emulation.height, dpr: emulation.dpr },
        { isMobile: emulation.mobile, hasTouch: emulation.hasTouch }
      );
    } else {
      await this.page.setUserAgent(this.defaultUserAgent);
      await this.cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: false }).catch(() => {});
      await this.applyViewport(fallbackViewport, { isMobile: false, hasTouch: false });
    }
    // UA and server-side responsive rendering only take effect on reload.
    if (this.page.url() !== 'about:blank') await this.page.reload().catch(() => {});
  }

  async startScreencast(): Promise<void> {
    this.screencasting = true;
    const captureDpr = Math.min(this.viewport.dpr, SCREENCAST_MAX_DPR);
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: SCREENCAST_QUALITY,
      maxWidth: Math.round(this.viewport.width * captureDpr),
      maxHeight: Math.round(this.viewport.height * captureDpr),
      everyNthFrame: 1,
    });
  }

  async stopScreencast(): Promise<void> {
    this.screencasting = false;
    await this.cdp.send('Page.stopScreencast').catch(() => {});
  }

  async dispatchInput(event: BrowserInputEvent): Promise<void> {
    for (const call of toCdpInput(event)) {
      await this.cdp.send(call.method as 'Input.dispatchMouseEvent', call.params as never).catch(() => {});
    }
  }

  async screenshot(): Promise<{ data: string; width: number; height: number }> {
    const data = await this.page.screenshot({
      type: 'jpeg',
      quality: 70,
      encoding: 'base64',
    });
    return { data, width: this.viewport.width, height: this.viewport.height };
  }

  async extractText(): Promise<{ url: string; title: string; text: string }> {
    const { title, text } = await this.page.evaluate(() => ({
      title: document.title,
      text: document.body?.innerText ?? '',
    }));
    return { url: this.page.url(), title, text };
  }

  async clickSelector(selector: string): Promise<boolean> {
    const el = await this.page.$(selector);
    if (!el) return false;
    await el.click().catch(() => {});
    await el.dispose().catch(() => {});
    return true;
  }

  async typeText(text: string, submit: boolean): Promise<void> {
    await this.page.keyboard.type(text);
    if (submit) await this.page.keyboard.press('Enter');
  }

  getState(): BrowserPageState {
    return this.state;
  }

  async close(): Promise<void> {
    this.closedByUs = true;
    await this.page.close().catch(() => {});
  }
}
