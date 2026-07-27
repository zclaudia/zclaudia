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
  constructor(public callbacks: EngineSessionCallbacks) {}
  async navigate(url: string) {
    this.navigated.push(url);
  }
  async history() {}
  async reload() {}
  async stop() {}
  async setViewport(v: unknown) {
    this.viewport = v;
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
    await manager.detach('s1');
    const s = engine.sessions[0];
    expect(s.screencasting).toBe(false);
    s.callbacks.onFrame('AAAA', { deviceWidth: 800, deviceHeight: 600 });
    expect(of('browser_frame')).toHaveLength(0);
  });

  it('state changes broadcast browser_state to the attached client', async () => {
    await manager.open('c1', 's1');
    await manager.attach('c1', 's1', { width: 800, height: 600, dpr: 1 });
    engine.sessions[0].callbacks.onState({ ...BLANK, url: 'http://x/', title: 'X' });
    expect(of('browser_state')).toHaveLength(1);
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
    await manager.close('s1', 'user');
    expect(engine.sessions[0].closed).toBe(true);
    const closed = of('browser_closed');
    expect(closed).toHaveLength(1);
    expect((closed[0].msg as { reason: string }).reason).toBe('user');
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
});
