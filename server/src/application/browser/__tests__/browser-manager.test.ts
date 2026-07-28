import { describe, it, expect, beforeEach } from 'vitest';
import type { ServerMessage, BrowserPageState } from '@zclaudia/shared';
import type { BrowserEngine, EngineSession, EngineSessionCallbacks } from '../engine.js';
import { BrowserManager } from '../browser-manager.js';

const BLANK: BrowserPageState = {
  url: 'about:blank',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
};

class FakeSession implements EngineSession {
  navigated: string[] = [];
  screencasting = false;
  closed = false;
  inputs: unknown[] = [];
  viewport: unknown = null;
  historyCalls: Array<'back' | 'forward'> = [];
  reloadCalls = 0;
  stopCalls = 0;
  resizes: unknown[] = [];
  screenshots = 0;
  clicked: string[] = [];
  typed: Array<{ text: string; submit: boolean }> = [];
  constructor(public callbacks: EngineSessionCallbacks) {}
  async navigate(url: string) {
    this.navigated.push(url);
  }
  async history(direction: 'back' | 'forward') {
    this.historyCalls.push(direction);
  }
  async reload() {
    this.reloadCalls++;
  }
  async stop() {
    this.stopCalls++;
  }
  async setViewport(v: unknown) {
    this.viewport = v;
    this.resizes.push(v);
  }
  async startScreencast() {
    this.screencasting = true;
  }
  async stopScreencast() {
    this.screencasting = false;
  }
  async dispatchInput(e: unknown) {
    this.inputs.push(e);
  }
  getState() {
    return BLANK;
  }
  async close() {
    this.closed = true;
  }
  async screenshot() {
    this.screenshots += 1;
    return { data: 'AAAA', width: 800, height: 600 };
  }
  async extractText() {
    return { url: 'http://x/', title: 'X', text: 'hello world' };
  }
  async clickSelector(selector: string) {
    this.clicked.push(selector);
    return selector !== '#missing';
  }
  async typeText(text: string, submit: boolean) {
    this.typed.push({ text, submit });
  }
}

class FakeEngine implements BrowserEngine {
  sessions: FakeSession[] = [];
  available = true;
  async engineStatus() {
    return this.available
      ? { status: 'ready' as const, executablePath: '/fake/chrome' }
      : { status: 'missing' as const };
  }
  async createSession(callbacks: EngineSessionCallbacks) {
    const s = new FakeSession(callbacks);
    this.sessions.push(s);
    return s;
  }
  async dispose() {}
}

describe('BrowserManager', () => {
  let engine: FakeEngine;
  let sent: Array<{ clientId: string; msg: ServerMessage }>;
  let manager: BrowserManager;

  beforeEach(() => {
    engine = new FakeEngine();
    sent = [];
    manager = new BrowserManager(engine, (clientId, msg) => sent.push({ clientId, msg }));
  });

  const of = (type: string) => sent.filter((s) => s.msg.type === type);

  it('open creates one session per sessionId (idempotent) and replies browser_opened', async () => {
    await manager.open('c1', 's1');
    await manager.open('c1', 's1');
    expect(engine.sessions).toHaveLength(1);
    expect(of('browser_opened')).toHaveLength(2);
  });

  it('open with url navigates a fresh session', async () => {
    await manager.open('c1', 's1', 'http://localhost:5173');
    expect(engine.sessions[0].navigated).toEqual(['http://localhost:5173']);
  });

  it('open reports engine_status missing and creates nothing when engine unavailable', async () => {
    engine.available = false;
    await manager.open('c1', 's1');
    expect(engine.sessions).toHaveLength(0);
    const statuses = of('browser_engine_status');
    expect(statuses).toHaveLength(1);
    expect((statuses[0].msg as { status: string }).status).toBe('missing');
  });

  it('attach starts screencast, sets viewport, and frames flow to the attached client only', async () => {
    await manager.open('c1', 's1');
    await manager.attach('c1', 's1', { width: 800, height: 600, dpr: 2 });
    const s = engine.sessions[0];
    expect(s.screencasting).toBe(true);
    expect(s.viewport).toEqual({ width: 800, height: 600, dpr: 2 });
    s.callbacks.onFrame('AAAA', { deviceWidth: 800, deviceHeight: 600 });
    const frames = of('browser_frame');
    expect(frames).toHaveLength(1);
    expect(frames[0].clientId).toBe('c1');
  });

  it('detach stops the screencast and drops frames', async () => {
    await manager.open('c1', 's1');
    await manager.attach('c1', 's1', { width: 800, height: 600, dpr: 1 });
    await manager.detach('c1', 's1');
    const s = engine.sessions[0];
    expect(s.screencasting).toBe(false);
    s.callbacks.onFrame('AAAA', { deviceWidth: 800, deviceHeight: 600 });
    expect(of('browser_frame')).toHaveLength(0);
  });

  it('detach is a no-op for a client that does not own the attach (stale/duplicate detach)', async () => {
    await manager.open('c1', 's1');
    await manager.attach('c1', 's1', { width: 800, height: 600, dpr: 1 });
    await manager.detach('c2', 's1');
    const s = engine.sessions[0];
    expect(s.screencasting).toBe(true);
    s.callbacks.onFrame('AAAA', { deviceWidth: 800, deviceHeight: 600 });
    expect(of('browser_frame')).toHaveLength(1);
  });

  it('state changes broadcast browser_state to the attached client', async () => {
    await manager.open('c1', 's1');
    await manager.attach('c1', 's1', { width: 800, height: 600, dpr: 1 });
    engine.sessions[0].callbacks.onState({ ...BLANK, url: 'http://x/', title: 'X' });
    const states = of('browser_state');
    expect(states).toHaveLength(2); // 1 from attach (replay), 1 from onState change
    expect((states[1].msg as { state: BrowserPageState }).state.url).toBe('http://x/');
    expect((states[1].msg as { state: BrowserPageState }).state.title).toBe('X');
  });

  it('input and navigate delegate to the session', async () => {
    await manager.open('c1', 's1');
    await manager.input('s1', { kind: 'mouse', type: 'move', x: 1, y: 2 });
    await manager.navigate('s1', 'http://y/');
    const s = engine.sessions[0];
    expect(s.inputs).toHaveLength(1);
    expect(s.navigated).toContain('http://y/');
  });

  it('close destroys the session and notifies with reason', async () => {
    await manager.open('c1', 's1');
    await manager.attach('c1', 's1', { width: 800, height: 600, dpr: 1 });
    await manager.close('c1', 's1', 'user');
    expect(engine.sessions[0].closed).toBe(true);
    const closed = of('browser_closed');
    expect(closed).toHaveLength(1);
    expect((closed[0].msg as { reason: string }).reason).toBe('user');
  });

  it('close(user) is refused for a non-owner while another client is attached', async () => {
    await manager.open('c1', 's1');
    await manager.attach('c1', 's1', { width: 800, height: 600, dpr: 1 });
    await manager.close('c2', 's1', 'user');
    expect(engine.sessions[0].closed).toBe(false);
    expect(of('browser_closed')).toHaveLength(0);
  });

  it('close(user) is allowed when nobody is attached yet', async () => {
    await manager.open('c1', 's1');
    await manager.close('c2', 's1', 'user');
    // No client is attached to receive browser_closed, but the session itself must be torn down.
    expect(engine.sessions[0].closed).toBe(true);
  });

  it('crash callback notifies browser_closed(crash) and forgets the session', async () => {
    await manager.open('c1', 's1');
    await manager.attach('c1', 's1', { width: 800, height: 600, dpr: 1 });
    engine.sessions[0].callbacks.onCrashed();
    const closed = of('browser_closed');
    expect(closed).toHaveLength(1);
    expect((closed[0].msg as { reason: string }).reason).toBe('crash');
    // a new open creates a fresh session
    await manager.open('c1', 's1');
    expect(engine.sessions).toHaveLength(2);
  });

  it('detachClient stops streams owned by that client but keeps pages alive', async () => {
    await manager.open('c1', 's1');
    await manager.attach('c1', 's1', { width: 800, height: 600, dpr: 1 });
    manager.detachClient('c1');
    expect(engine.sessions[0].screencasting).toBe(false);
    expect(engine.sessions[0].closed).toBe(false);
  });

  it('dispose closes all sessions with reason shutdown', async () => {
    await manager.open('c1', 's1');
    await manager.attach('c1', 's1', { width: 800, height: 600, dpr: 1 });
    await manager.dispose();
    expect(engine.sessions[0].closed).toBe(true);
    expect((of('browser_closed')[0].msg as { reason: string }).reason).toBe('shutdown');
  });

  it('history delegates back/forward to the session', async () => {
    await manager.open('c1', 's1');
    await manager.history('s1', 'back');
    await manager.history('s1', 'forward');
    expect(engine.sessions[0].historyCalls).toEqual(['back', 'forward']);
  });

  it('reload delegates to the session', async () => {
    await manager.open('c1', 's1');
    await manager.reload('s1');
    expect(engine.sessions[0].reloadCalls).toBe(1);
  });

  it('stop delegates to the session', async () => {
    await manager.open('c1', 's1');
    await manager.stop('s1');
    expect(engine.sessions[0].stopCalls).toBe(1);
  });

  it('resize delegates setViewport to the session', async () => {
    await manager.open('c1', 's1');
    await manager.attach('c1', 's1', { width: 800, height: 600, dpr: 1 });
    await manager.resize('s1', { width: 1024, height: 768, dpr: 1.5 });
    expect(engine.sessions[0].resizes).toHaveLength(2); // 1 from attach, 1 from resize
    expect(engine.sessions[0].resizes[1]).toEqual({ width: 1024, height: 768, dpr: 1.5 });
  });

  describe('agent methods', () => {
    it('ensureSession creates a session without any client reply', async () => {
      const res = await manager.ensureSession('s1');
      expect(res).toEqual({ ok: true });
      expect(engine.sessions).toHaveLength(1);
      expect(sent).toHaveLength(0); // no browser_opened, no engine_status
    });

    it('ensureSession is idempotent and reports engine_missing', async () => {
      await manager.ensureSession('s1');
      await manager.ensureSession('s1');
      expect(engine.sessions).toHaveLength(1);
      engine.available = false;
      const res = await manager.ensureSession('s2');
      expect(res).toEqual({ ok: false, reason: 'engine_missing' });
      expect(engine.sessions).toHaveLength(1);
    });

    it('screenshot/extractText/clickSelector/typeText delegate to the session', async () => {
      await manager.ensureSession('s1');
      expect(await manager.screenshot('s1')).toEqual({ data: 'AAAA', width: 800, height: 600 });
      expect(await manager.extractText('s1')).toEqual({ url: 'http://x/', title: 'X', text: 'hello world' });
      expect(await manager.clickSelector('s1', '#btn')).toBe(true);
      expect(await manager.clickSelector('s1', '#missing')).toBe(false);
      expect(await manager.typeText('s1', 'hi', true)).toBe(true);
      expect(engine.sessions[0].typed).toEqual([{ text: 'hi', submit: true }]);
    });

    it('agent methods return null/false when no session exists', async () => {
      expect(await manager.screenshot('nope')).toBeNull();
      expect(await manager.extractText('nope')).toBeNull();
      expect(await manager.clickSelector('nope', '#x')).toBeNull();
      expect(await manager.typeText('nope', 'hi', false)).toBe(false);
      expect(manager.getState('nope')).toBeNull();
    });

    it('getState returns the live session state', async () => {
      await manager.ensureSession('s1');
      expect(manager.getState('s1')).toEqual(BLANK);
    });
  });
});

/** FakeEngine whose createSession() only resolves once the test explicitly releases it. */
class GatedFakeEngine extends FakeEngine {
  private gateResolve: (() => void) | null = null;
  private gate: Promise<void> = Promise.resolve();
  createSessionCalls = 0;

  /** Blocks subsequent createSession() calls until release() is invoked. */
  hold(): void {
    this.gate = new Promise((resolve) => {
      this.gateResolve = resolve;
    });
  }

  release(): void {
    this.gateResolve?.();
    this.gateResolve = null;
  }

  async createSession(callbacks: EngineSessionCallbacks) {
    this.createSessionCalls++;
    await this.gate;
    return super.createSession(callbacks);
  }
}

describe('BrowserManager open() race conditions', () => {
  it('attach arriving while open() is still launching Chrome waits, then replays state (no silent no-op)', async () => {
    const engine = new GatedFakeEngine();
    const sent: Array<{ clientId: string; msg: ServerMessage }> = [];
    const manager = new BrowserManager(engine, (clientId, msg) => sent.push({ clientId, msg }));
    const of = (type: string) => sent.filter((s) => s.msg.type === type);

    engine.hold();
    const openPromise = manager.open('c1', 's1'); // Not awaited: Chrome launch is "in flight".
    const attachPromise = manager.attach('c1', 's1', { width: 800, height: 600, dpr: 1 });

    // Give both async calls a chance to run up to the gate.
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.createSessionCalls).toBe(1);
    expect(of('browser_opened')).toHaveLength(0); // Still waiting on the gate.

    engine.release();
    await openPromise;
    await attachPromise;

    const s = engine.sessions[0];
    expect(s.screencasting).toBe(true);
    expect(s.viewport).toEqual({ width: 800, height: 600, dpr: 1 });
    expect(of('browser_opened')).toHaveLength(1);
    expect(of('browser_state').length).toBeGreaterThanOrEqual(1);
  });

  it('two concurrent open() calls for the same sessionId create exactly one engine session; both callers get browser_opened', async () => {
    const engine = new GatedFakeEngine();
    const sent: Array<{ clientId: string; msg: ServerMessage }> = [];
    const manager = new BrowserManager(engine, (clientId, msg) => sent.push({ clientId, msg }));
    const of = (type: string) => sent.filter((s) => s.msg.type === type);

    engine.hold();
    const open1 = manager.open('c1', 's1');
    const open2 = manager.open('c2', 's1');
    engine.release();
    await Promise.all([open1, open2]);

    expect(engine.createSessionCalls).toBe(1);
    expect(engine.sessions).toHaveLength(1);
    const opened = of('browser_opened');
    expect(opened).toHaveLength(2);
    expect(opened.map((o) => o.clientId).sort()).toEqual(['c1', 'c2']);
  });
});
