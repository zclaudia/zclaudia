import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const DEFAULT_WIDTH_PX = 380;
const MIN_WIDTH_PX = 240;
const MAX_WIDTH_VW = 50;

interface RightSidebarState {
  widthPx: number;
  /** Preferred active tab — may not match a currently-visible panel; consumers fallback. */
  activeTab: string | null;
  /** User-collapsed: hide the sidebar even while panels remain open (mounted). */
  collapsed: boolean;
  /** A right panel opened while collapsed — surfaced as a dot on the header toggle. */
  unread: boolean;
  setActiveTab: (panelId: string) => void;
  setWidth: (px: number) => void;
  /** Collapse/expand; expanding always clears the unread marker. */
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  /** Flag new activity — only takes effect while collapsed (otherwise it's already visible). */
  markUnread: () => void;
}

export const useRightSidebarStore = create<RightSidebarState>()(
  persist(
    (set, get) => ({
      widthPx: DEFAULT_WIDTH_PX,
      activeTab: null,
      // Default collapsed — the right panel opens on demand via the header toggle
      // or a pinned tool tab, keeping the chat full-width until the user wants tools.
      collapsed: true,
      unread: false,
      setActiveTab: (panelId) => set({ activeTab: panelId }),
      setWidth: (px) => {
        const maxPx = (typeof window !== 'undefined' ? window.innerWidth : 1920) * (MAX_WIDTH_VW / 100);
        set({ widthPx: Math.max(MIN_WIDTH_PX, Math.min(maxPx, px)) });
      },
      setCollapsed: (collapsed) => set(collapsed ? { collapsed } : { collapsed, unread: false }),
      toggleCollapsed: () => {
        const next = !get().collapsed;
        set(next ? { collapsed: next } : { collapsed: next, unread: false });
      },
      markUnread: () => {
        if (get().collapsed) set({ unread: true });
      },
    }),
    {
      name: 'claudia-right-sidebar',
      partialize: (state) => ({
        widthPx: state.widthPx,
        activeTab: state.activeTab,
        collapsed: state.collapsed,
      }),
    },
  ),
);

export const RIGHT_SIDEBAR_LIMITS = {
  MIN_WIDTH_PX,
  MAX_WIDTH_VW,
  DEFAULT_WIDTH_PX,
};
