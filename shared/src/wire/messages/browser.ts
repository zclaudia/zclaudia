// Browser panel: server-side Chromium screencast + input forwarding.
// Frames travel as base64 JPEG inside JSON (CDP Page.screencastFrame
// already emits base64; the terminal channel is the streaming precedent).

export interface BrowserViewport {
  width: number; // CSS px
  height: number; // CSS px
  dpr: number; // devicePixelRatio
}

/**
 * Device emulation descriptor. Presets live client-side; the server applies
 * these values verbatim. `null` (in messages) means desktop mode — the
 * viewport passively tracks the panel container via browser_resize.
 */
export interface BrowserDeviceEmulation {
  /** Preset identity for UI display sync; opaque to the server. */
  presetId: string;
  width: number; // CSS px
  height: number; // CSS px
  dpr: number;
  userAgent: string;
  /** CDP isMobile: mobile layout viewport + meta-viewport handling. */
  mobile: boolean;
  hasTouch: boolean;
}

export interface BrowserConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
  /** epoch ms */
  ts: number;
  /** source location, e.g. "http://localhost:5173/src/App.tsx:12" */
  location?: string;
}

/** One network request's lifecycle, upserted by id as request → response → finished/failed. */
export interface BrowserNetworkEntry {
  id: string;
  url: string;
  method: string;
  /** CDP resource type, e.g. "document", "xhr", "fetch", "script". */
  resourceType: string;
  status?: number;
  /** Set when the request failed at the network level (DNS, refused, aborted…). */
  errorText?: string;
  contentType?: string;
  sizeBytes?: number;
  durationMs?: number;
  /** epoch ms of the request start */
  ts: number;
}

/** Summary of an element the user picked in the panel (Overlay inspect mode). */
export interface BrowserPickedElement {
  selector: string;
  tag: string;
  id?: string;
  classes: string[];
  /** truncated innerText */
  text?: string;
  /** truncated outerHTML */
  outerHtml: string;
  pageUrl: string;
}

export interface BrowserPageState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** Modifier bitmask uses CDP encoding: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export type BrowserInputEvent =
  | {
      kind: 'mouse';
      type: 'move' | 'down' | 'up';
      x: number;
      y: number;
      button?: 'left' | 'middle' | 'right';
      clickCount?: number;
      modifiers?: number;
    }
  | {
      kind: 'wheel';
      x: number;
      y: number;
      deltaX: number;
      deltaY: number;
      modifiers?: number;
    }
  | {
      kind: 'key';
      type: 'down' | 'up';
      key: string;
      code: string;
      text?: string;
      modifiers?: number;
    };

// ---- client → server ----

export interface BrowserOpenMessage {
  type: 'browser_open';
  sessionId: string;
  url?: string;
}

export interface BrowserAttachMessage {
  type: 'browser_attach';
  sessionId: string;
  viewport: BrowserViewport;
}

export interface BrowserDetachMessage {
  type: 'browser_detach';
  sessionId: string;
}

export interface BrowserCloseMessage {
  type: 'browser_close';
  sessionId: string;
}

export interface BrowserNavigateMessage {
  type: 'browser_navigate';
  sessionId: string;
  url: string;
}

export interface BrowserHistoryMessage {
  type: 'browser_history';
  sessionId: string;
  direction: 'back' | 'forward';
}

export interface BrowserReloadMessage {
  type: 'browser_reload';
  sessionId: string;
}

export interface BrowserStopMessage {
  type: 'browser_stop';
  sessionId: string;
}

export interface BrowserInputMessage {
  type: 'browser_input';
  sessionId: string;
  event: BrowserInputEvent;
}

export interface BrowserResizeMessage {
  type: 'browser_resize';
  sessionId: string;
  viewport: BrowserViewport;
}

export interface BrowserEngineInstallMessage {
  type: 'browser_engine_install';
}

/** Toggle Overlay inspect mode; the server auto-disables it after a pick. */
export interface BrowserPickElementMessage {
  type: 'browser_pick_element';
  sessionId: string;
  active: boolean;
}

export interface BrowserSetEmulationMessage {
  type: 'browser_set_emulation';
  sessionId: string;
  /** null = back to desktop mode. */
  emulation: BrowserDeviceEmulation | null;
  /** Current container viewport — the fallback applied when emulation is disabled. */
  viewport: BrowserViewport;
}

// ---- server → client ----

export interface BrowserOpenedMessage {
  type: 'browser_opened';
  sessionId: string;
  state: BrowserPageState;
}

export interface BrowserFrameMessage {
  type: 'browser_frame';
  sessionId: string;
  /** base64 JPEG */
  data: string;
  metadata: { deviceWidth: number; deviceHeight: number };
}

export interface BrowserStateMessage {
  type: 'browser_state';
  sessionId: string;
  state: BrowserPageState;
}

export interface BrowserClosedMessage {
  type: 'browser_closed';
  sessionId: string;
  reason: 'user' | 'crash' | 'idle' | 'shutdown';
}

export interface BrowserErrorMessage {
  type: 'browser_error';
  sessionId?: string;
  code: string;
  message: string;
}

export interface BrowserEngineStatusMessage {
  type: 'browser_engine_status';
  status: 'ready' | 'missing' | 'downloading' | 'error';
  /** 0..1 while downloading */
  progress?: number;
  executablePath?: string;
  message?: string;
}

/** Echoed on every emulation change and on attach (server is the source of truth). */
export interface BrowserEmulationMessage {
  type: 'browser_emulation';
  sessionId: string;
  emulation: BrowserDeviceEmulation | null;
}

export interface BrowserConsoleMessage {
  type: 'browser_console';
  sessionId: string;
  entries: BrowserConsoleEntry[];
  /** true = replace the whole list (attach replay, navigation clear); default append. */
  replace?: boolean;
}

/** Entries upsert by id; replace swaps the whole list (attach replay, navigation clear). */
export interface BrowserNetworkMessage {
  type: 'browser_network';
  sessionId: string;
  entries: BrowserNetworkEntry[];
  replace?: boolean;
}

export interface BrowserElementPickedMessage {
  type: 'browser_element_picked';
  sessionId: string;
  element: BrowserPickedElement;
}

/** Phase 3 uses this; defined now so the protocol doesn't churn. */
export interface BrowserAgentActivityMessage {
  type: 'browser_agent_activity';
  sessionId: string;
  active: boolean;
}

export type BrowserClientMessage =
  | BrowserOpenMessage
  | BrowserAttachMessage
  | BrowserDetachMessage
  | BrowserCloseMessage
  | BrowserNavigateMessage
  | BrowserHistoryMessage
  | BrowserReloadMessage
  | BrowserStopMessage
  | BrowserInputMessage
  | BrowserResizeMessage
  | BrowserEngineInstallMessage
  | BrowserSetEmulationMessage
  | BrowserPickElementMessage;

export type BrowserServerMessage =
  | BrowserOpenedMessage
  | BrowserFrameMessage
  | BrowserStateMessage
  | BrowserClosedMessage
  | BrowserErrorMessage
  | BrowserEngineStatusMessage
  | BrowserEmulationMessage
  | BrowserConsoleMessage
  | BrowserNetworkMessage
  | BrowserElementPickedMessage
  | BrowserAgentActivityMessage;
