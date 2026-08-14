import { create } from 'zustand';
import type {
  BrowserConsoleEntry,
  BrowserDeviceEmulation,
  BrowserNetworkEntry,
  BrowserPageState,
} from '@zclaudia/shared';

export interface BrowserSessionView {
  state: BrowserPageState | null;
  frame: { data: string; deviceWidth: number; deviceHeight: number } | null;
  closedReason: 'user' | 'crash' | 'idle' | 'shutdown' | null;
  error: string | null;
  agentActive: boolean;
  /** Server-echoed device emulation; null = desktop mode. */
  emulation: BrowserDeviceEmulation | null;
  console: BrowserConsoleEntry[];
  network: BrowserNetworkEntry[];
  /** Overlay element-inspect mode; flips off when a pick arrives. */
  pickActive: boolean;
}

export interface BrowserEngineView {
  status: 'unknown' | 'ready' | 'missing' | 'downloading' | 'error';
  progress?: number;
  message?: string;
}

const EMPTY_SESSION: BrowserSessionView = {
  state: null,
  frame: null,
  closedReason: null,
  error: null,
  agentActive: false,
  emulation: null,
  console: [],
  network: [],
  pickActive: false,
};

interface BrowserStore {
  engine: BrowserEngineView;
  sessions: Record<string, BrowserSessionView>;
  patchSession(sessionId: string, patch: Partial<BrowserSessionView>): void;
  setEngine(engine: BrowserEngineView): void;
  reset(): void;
}

export const useBrowserStore = create<BrowserStore>((set) => ({
  engine: { status: 'unknown' },
  sessions: {},
  patchSession: (sessionId, patch) =>
    set((s) => ({
      sessions: {
        ...s.sessions,
        [sessionId]: { ...(s.sessions[sessionId] ?? EMPTY_SESSION), ...patch },
      },
    })),
  setEngine: (engine) => set({ engine }),
  reset: () => set({ engine: { status: 'unknown' }, sessions: {} }),
}));
