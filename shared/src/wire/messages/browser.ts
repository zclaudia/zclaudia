// Browser panel: server-side Chromium screencast + input forwarding.
// Frames travel as base64 JPEG inside JSON (CDP Page.screencastFrame
// already emits base64; the terminal channel is the streaming precedent).

export interface BrowserViewport {
  width: number; // CSS px
  height: number; // CSS px
  dpr: number; // devicePixelRatio
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
  | BrowserEngineInstallMessage;

export type BrowserServerMessage =
  | BrowserOpenedMessage
  | BrowserFrameMessage
  | BrowserStateMessage
  | BrowserClosedMessage
  | BrowserErrorMessage
  | BrowserEngineStatusMessage
  | BrowserAgentActivityMessage;
