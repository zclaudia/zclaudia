import type {
  BrowserConsoleEntry,
  BrowserDeviceEmulation,
  BrowserInputEvent,
  BrowserPageState,
  BrowserViewport,
  ServerMessage,
} from '@zclaudia/shared';
import type { BrowserEngine, EngineSession } from './engine.js';

const CONSOLE_BUFFER_MAX = 500;
const CONSOLE_TEXT_MAX = 2000;

interface ManagedBrowserSession {
  session: EngineSession;
  attachedClientId: string | null;
  streaming: boolean;
  emulation: BrowserDeviceEmulation | null;
  /** Ring buffer; accrues even while detached so the agent can read it. */
  console: BrowserConsoleEntry[];
}

/**
 * Owns one browser page per chat session. Mirrors TerminalManager's DI
 * shape: constructed once in server.ts with a per-client send callback.
 */
export class BrowserManager {
  private sessions = new Map<string, ManagedBrowserSession>();
  /** In-flight open() calls per sessionId, so concurrent opens/attaches don't race the engine launch. */
  private opening = new Map<string, Promise<void>>();

  constructor(
    private engine: BrowserEngine,
    private sendToClient: (clientId: string, msg: ServerMessage) => void
  ) {}

  private send(managed: ManagedBrowserSession, msg: ServerMessage): void {
    if (managed.attachedClientId) this.sendToClient(managed.attachedClientId, msg);
  }

  /** Await any in-flight open() for this sessionId before touching `this.sessions`. */
  private async ready(sessionId: string): Promise<void> {
    const inFlight = this.opening.get(sessionId);
    if (inFlight) await inFlight;
  }

  /**
   * Ensure a session exists for sessionId, deduping concurrent creates.
   * Returns null when the engine is unavailable. Sends nothing to clients.
   */
  private async ensure(sessionId: string, url?: string): Promise<ManagedBrowserSession | null> {
    // Dedup concurrent open() calls for the same sessionId onto a single engine
    // session creation (fixes the React StrictMode double-mount Page leak): the
    // first caller creates the shared promise, later callers just await it.
    let create = this.opening.get(sessionId);
    if (!create && !this.sessions.has(sessionId)) {
      create = this.createSession(sessionId, url);
      this.opening.set(sessionId, create);
      const cleanup = () => {
        if (this.opening.get(sessionId) === create) this.opening.delete(sessionId);
      };
      // .then(cb, cb) instead of .finally: the derived promise must not adopt
      // create's rejection, or a failed launch triggers unhandledRejection.
      void create.then(cleanup, cleanup);
    }
    if (create) await create;
    return this.sessions.get(sessionId) ?? null;
  }

  async open(clientId: string, sessionId: string, url?: string): Promise<void> {
    const managed = await this.ensure(sessionId, url);
    if (!managed) {
      this.sendToClient(clientId, { type: 'browser_engine_status', status: 'missing' });
      return;
    }
    this.sendToClient(clientId, {
      type: 'browser_opened',
      sessionId,
      state: managed.session.getState(),
    });
  }

  async ensureSession(sessionId: string): Promise<{ ok: true } | { ok: false; reason: 'engine_missing' }> {
    const managed = await this.ensure(sessionId);
    return managed ? { ok: true } : { ok: false, reason: 'engine_missing' };
  }

  async screenshot(sessionId: string): Promise<{ data: string; width: number; height: number } | null> {
    await this.ready(sessionId);
    const managed = this.sessions.get(sessionId);
    return managed ? managed.session.screenshot() : null;
  }

  async extractText(sessionId: string): Promise<{ url: string; title: string; text: string } | null> {
    await this.ready(sessionId);
    const managed = this.sessions.get(sessionId);
    return managed ? managed.session.extractText() : null;
  }

  async clickSelector(sessionId: string, selector: string): Promise<boolean | null> {
    await this.ready(sessionId);
    const managed = this.sessions.get(sessionId);
    return managed ? managed.session.clickSelector(selector) : null;
  }

  async typeText(sessionId: string, text: string, submit: boolean): Promise<boolean> {
    await this.ready(sessionId);
    const managed = this.sessions.get(sessionId);
    if (!managed) return false;
    await managed.session.typeText(text, submit);
    return true;
  }

  /** Synchronous by contract (returns BrowserPageState | null); callers racing a cold open should use ensureSession() first. */
  getState(sessionId: string): BrowserPageState | null {
    return this.sessions.get(sessionId)?.session.getState() ?? null;
  }

  /** Launches the engine session for sessionId exactly once; only called while holding `opening`. */
  private async createSession(sessionId: string, url: string | undefined): Promise<void> {
    const status = await this.engine.engineStatus();
    if (status.status !== 'ready') {
      return;
    }
    // Create entry object before passing to engine callbacks so they can capture and reference it.
    const entry: ManagedBrowserSession = {
      session: null as unknown as EngineSession,
      attachedClientId: null,
      streaming: false,
      emulation: null,
      console: [],
    };
    entry.session = await this.engine.createSession({
      onFrame: (data, metadata) => {
        if (entry.streaming) this.send(entry, { type: 'browser_frame', sessionId, data, metadata });
      },
      onState: (state) => this.send(entry, { type: 'browser_state', sessionId, state }),
      onCrashed: () => {
        this.send(entry, { type: 'browser_closed', sessionId, reason: 'crash' });
        this.sessions.delete(sessionId);
      },
      onConsole: (raw) => {
        const item: BrowserConsoleEntry =
          raw.text.length > CONSOLE_TEXT_MAX ? { ...raw, text: `${raw.text.slice(0, CONSOLE_TEXT_MAX)}…` } : raw;
        entry.console.push(item);
        if (entry.console.length > CONSOLE_BUFFER_MAX) entry.console.splice(0, entry.console.length - CONSOLE_BUFFER_MAX);
        this.send(entry, { type: 'browser_console', sessionId, entries: [item] });
      },
      onConsoleReset: () => {
        entry.console = [];
        this.send(entry, { type: 'browser_console', sessionId, entries: [], replace: true });
      },
    });
    this.sessions.set(sessionId, entry);
    if (url) await entry.session.navigate(url);
  }

  async attach(clientId: string, sessionId: string, viewport: BrowserViewport): Promise<void> {
    await this.ready(sessionId);
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    managed.attachedClientId = clientId;
    managed.streaming = true;
    // An emulated session keeps its pinned device viewport — the client's
    // container measure only applies in desktop mode.
    if (!managed.emulation) await managed.session.setViewport(viewport);
    await managed.session.startScreencast();
    this.send(managed, { type: 'browser_state', sessionId, state: managed.session.getState() });
    // Resync toggle state and replay the console buffer for (re)connecting clients.
    this.send(managed, { type: 'browser_emulation', sessionId, emulation: managed.emulation });
    this.send(managed, { type: 'browser_console', sessionId, entries: managed.console, replace: true });
  }

  async detach(clientId: string, sessionId: string): Promise<void> {
    await this.ready(sessionId);
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    if (managed.attachedClientId !== clientId) return;
    managed.streaming = false;
    managed.attachedClientId = null;
    await managed.session.stopScreencast();
  }

  async close(clientId: string, sessionId: string, reason: 'user' | 'idle' | 'shutdown'): Promise<void> {
    await this.ready(sessionId);
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    if (reason === 'user' && managed.attachedClientId !== null && managed.attachedClientId !== clientId) {
      return; // Refused: another client owns the attach.
    }
    await this.closeInternal(sessionId, managed, reason);
  }

  /** Closes unconditionally, regardless of ownership. Used by dispose()/crash paths. */
  private async closeInternal(
    sessionId: string,
    managed: ManagedBrowserSession,
    reason: 'user' | 'idle' | 'shutdown'
  ): Promise<void> {
    this.send(managed, { type: 'browser_closed', sessionId, reason });
    this.sessions.delete(sessionId);
    await managed.session.close();
  }

  async navigate(sessionId: string, url: string): Promise<void> {
    await this.ready(sessionId);
    await this.sessions.get(sessionId)?.session.navigate(url);
  }

  async history(sessionId: string, direction: 'back' | 'forward'): Promise<void> {
    await this.ready(sessionId);
    await this.sessions.get(sessionId)?.session.history(direction);
  }

  async reload(sessionId: string): Promise<void> {
    await this.ready(sessionId);
    await this.sessions.get(sessionId)?.session.reload();
  }

  async stop(sessionId: string): Promise<void> {
    await this.ready(sessionId);
    await this.sessions.get(sessionId)?.session.stop();
  }

  async input(sessionId: string, event: BrowserInputEvent): Promise<void> {
    await this.ready(sessionId);
    await this.sessions.get(sessionId)?.session.dispatchInput(event);
  }

  async resize(sessionId: string, viewport: BrowserViewport): Promise<void> {
    await this.ready(sessionId);
    const managed = this.sessions.get(sessionId);
    if (!managed || managed.emulation) return; // device viewport is pinned while emulating
    await managed.session.setViewport(viewport);
  }

  async setEmulation(
    sessionId: string,
    emulation: BrowserDeviceEmulation | null,
    fallbackViewport: BrowserViewport
  ): Promise<void> {
    await this.ready(sessionId);
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    managed.emulation = emulation;
    await managed.session.setEmulation(emulation, fallbackViewport);
    this.send(managed, { type: 'browser_emulation', sessionId, emulation });
  }

  getConsole(sessionId: string): BrowserConsoleEntry[] | null {
    return this.sessions.get(sessionId)?.console ?? null;
  }

  /** WS connection closed: stop streams for that client; pages stay alive. */
  detachClient(clientId: string): void {
    for (const managed of this.sessions.values()) {
      if (managed.attachedClientId === clientId) {
        managed.streaming = false;
        managed.attachedClientId = null;
        void managed.session.stopScreencast().catch(() => {});
      }
    }
  }

  async dispose(): Promise<void> {
    for (const [sessionId, managed] of [...this.sessions]) {
      await this.closeInternal(sessionId, managed, 'shutdown');
    }
    await this.engine.dispose();
  }
}
