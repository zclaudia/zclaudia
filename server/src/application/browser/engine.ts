import type { BrowserInputEvent, BrowserPageState, BrowserViewport } from '@zclaudia/shared';

export interface EngineSessionCallbacks {
  onFrame(data: string, metadata: { deviceWidth: number; deviceHeight: number }): void;
  onState(state: BrowserPageState): void;
  /** Fired when the page/browser dies underneath us (not via close()). */
  onCrashed(): void;
}

export interface EngineSession {
  navigate(url: string): Promise<void>;
  history(direction: 'back' | 'forward'): Promise<void>;
  reload(): Promise<void>;
  stop(): Promise<void>;
  setViewport(viewport: BrowserViewport): Promise<void>;
  startScreencast(): Promise<void>;
  stopScreencast(): Promise<void>;
  dispatchInput(event: BrowserInputEvent): Promise<void>;
  getState(): BrowserPageState;
  close(): Promise<void>;
}

export interface EngineStatus {
  status: 'ready' | 'missing';
  executablePath?: string;
}

export interface BrowserEngine {
  engineStatus(): Promise<EngineStatus>;
  /** Lazily launches the browser process on first call. */
  createSession(callbacks: EngineSessionCallbacks): Promise<EngineSession>;
  /** Closes the browser process. Safe to call repeatedly. */
  dispose(): Promise<void>;
}
