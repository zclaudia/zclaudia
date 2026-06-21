import { create } from 'zustand';

/**
 * A tool panel surfaced as a pinned tab in the right sidebar (desktop).
 *
 * Published by the composer (ChatInputArea), which owns the per-session context
 * and open/close logic, and consumed by RightSidebar — this decouples the pinned
 * tab strip from the composer without threading sessionId/send callbacks through
 * the layout.
 */
export interface SessionTool {
  /** Matches the panel id (e.g. 'terminal', 'session-changes') for active/content sync. */
  id: string;
  label: string;
  iconKey: 'draft' | 'file' | 'changes' | 'terminal' | 'lineage';
  isActive: boolean;
  hasBadge?: boolean;
  onClick: () => void;
}

interface SessionToolsState {
  tools: SessionTool[];
  setTools: (tools: SessionTool[]) => void;
}

export const useSessionToolsStore = create<SessionToolsState>((set) => ({
  tools: [],
  setTools: (tools) => set({ tools }),
}));
