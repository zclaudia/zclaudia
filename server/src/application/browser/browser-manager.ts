import type {
  BrowserInputEvent,
  BrowserViewport,
  ServerMessage,
} from '@zclaudia/shared';
import type { BrowserEngine, EngineSession } from './engine.js';

interface ManagedBrowserSession {
  session: EngineSession;
  attachedClientId: string | null;
  streaming: boolean;
}

/**
 * Owns one browser page per chat session. Mirrors TerminalManager's DI
 * shape: constructed once in server.ts with a per-client send callback.
 */
export class BrowserManager {
  private sessions = new Map<string, ManagedBrowserSession>();

  constructor(
    private engine: BrowserEngine,
    private sendToClient: (clientId: string, msg: ServerMessage) => void
  ) {}

  private send(managed: ManagedBrowserSession, msg: ServerMessage): void {
    if (managed.attachedClientId) this.sendToClient(managed.attachedClientId, msg);
  }

  async open(clientId: string, sessionId: string, url?: string): Promise<void> {
    let managed = this.sessions.get(sessionId);
    if (!managed) {
      const status = await this.engine.engineStatus();
      if (status.status !== 'ready') {
        this.sendToClient(clientId, { type: 'browser_engine_status', status: 'missing' });
        return;
      }
      const entry: ManagedBrowserSession = {
        session: null as unknown as EngineSession,
        attachedClientId: null,
        streaming: false,
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
      });
      this.sessions.set(sessionId, entry);
      managed = entry;
      if (url) await managed.session.navigate(url);
    }
    this.sendToClient(clientId, {
      type: 'browser_opened',
      sessionId,
      state: managed.session.getState(),
    });
  }

  async attach(clientId: string, sessionId: string, viewport: BrowserViewport): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    managed.attachedClientId = clientId;
    managed.streaming = true;
    await managed.session.setViewport(viewport);
    await managed.session.startScreencast();
  }

  async detach(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    managed.streaming = false;
    managed.attachedClientId = null;
    await managed.session.stopScreencast();
  }

  async close(sessionId: string, reason: 'user' | 'idle' | 'shutdown'): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;
    this.send(managed, { type: 'browser_closed', sessionId, reason });
    this.sessions.delete(sessionId);
    await managed.session.close();
  }

  async navigate(sessionId: string, url: string): Promise<void> {
    await this.sessions.get(sessionId)?.session.navigate(url);
  }

  async history(sessionId: string, direction: 'back' | 'forward'): Promise<void> {
    await this.sessions.get(sessionId)?.session.history(direction);
  }

  async reload(sessionId: string): Promise<void> {
    await this.sessions.get(sessionId)?.session.reload();
  }

  async stop(sessionId: string): Promise<void> {
    await this.sessions.get(sessionId)?.session.stop();
  }

  async input(sessionId: string, event: BrowserInputEvent): Promise<void> {
    await this.sessions.get(sessionId)?.session.dispatchInput(event);
  }

  async resize(sessionId: string, viewport: BrowserViewport): Promise<void> {
    await this.sessions.get(sessionId)?.session.setViewport(viewport);
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
    for (const [sessionId] of this.sessions) {
      await this.close(sessionId, 'shutdown');
    }
    await this.engine.dispose();
  }
}
