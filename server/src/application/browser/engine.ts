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
  /** Base64 JPEG of the current view. */
  screenshot(): Promise<{ data: string; width: number; height: number }>;
  /** Visible text of the current page (agent read_page). */
  extractText(): Promise<{ url: string; title: string; text: string }>;
  /** Click the first element matching a CSS selector. False when not found. */
  clickSelector(selector: string): Promise<boolean>;
  /** Type into the focused element; optionally press Enter after. */
  typeText(text: string, submit: boolean): Promise<void>;
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
