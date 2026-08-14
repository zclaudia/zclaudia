import type {
  BrowserConsoleEntry,
  BrowserDeviceEmulation,
  BrowserInputEvent,
  BrowserNetworkEntry,
  BrowserPageState,
  BrowserPickedElement,
  BrowserViewport,
} from '@zclaudia/shared';

export interface EngineSessionCallbacks {
  onFrame(data: string, metadata: { deviceWidth: number; deviceHeight: number }): void;
  onState(state: BrowserPageState): void;
  /** Fired when the page/browser dies underneath us (not via close()). */
  onCrashed(): void;
  /** Console API calls and uncaught page errors. */
  onConsole(entry: BrowserConsoleEntry): void;
  /** Main-frame navigation — mirrors Chrome's clear-console-on-navigation. */
  onConsoleReset(): void;
  /** Request lifecycle updates; the same entry id is re-emitted as it progresses. */
  onNetwork(entry: BrowserNetworkEntry): void;
  /** A main-frame navigation request started — clear the network log (DevTools behavior). */
  onNetworkReset(): void;
  /** The user picked an element via Overlay inspect mode. */
  onElementPicked(element: BrowserPickedElement): void;
}

export interface EngineSession {
  navigate(url: string): Promise<void>;
  history(direction: 'back' | 'forward'): Promise<void>;
  reload(): Promise<void>;
  stop(): Promise<void>;
  setViewport(viewport: BrowserViewport): Promise<void>;
  /**
   * Enable device emulation (fixed viewport + UA + touch, then reload), or
   * disable it (null) and fall back to `fallbackViewport`.
   */
  setEmulation(emulation: BrowserDeviceEmulation | null, fallbackViewport: BrowserViewport): Promise<void>;
  /**
   * Toggle Overlay element-inspect mode: hover highlights render into the
   * screencast, a click fires onElementPicked and auto-disables the mode.
   */
  setInspectMode(active: boolean): Promise<void>;
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
