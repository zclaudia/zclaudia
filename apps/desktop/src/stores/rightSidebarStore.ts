import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Width is stored as a FRACTION of the chat/panel container width (not absolute
// px), so the right panel scales proportionally with the window — resizing the
// window grows/shrinks the panel and the chat area together instead of leaving
// the panel a fixed width. Absolute floor is enforced at render via CSS minWidth.
const DEFAULT_WIDTH_FRACTION = 0.26; // ~380px on a typical content area
const MIN_WIDTH_FRACTION = 0.15;
const MAX_WIDTH_FRACTION = 0.5;
const MIN_WIDTH_PX = 240; // usability floor, applied as CSS min-width

const clampFraction = (f: number) => Math.max(MIN_WIDTH_FRACTION, Math.min(MAX_WIDTH_FRACTION, f));

interface RightSidebarState {
  /** Panel width as a fraction (0..1) of the container width. */
  widthFraction: number;
  /** User-collapsed: hide the sidebar even while panels remain open (mounted). */
  collapsed: boolean;
  /** A right panel opened while collapsed — surfaced as a dot on the header toggle. */
  unread: boolean;
  setWidthFraction: (fraction: number) => void;
  /** Collapse/expand; expanding always clears the unread marker. */
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  /** Flag new activity — only takes effect while collapsed (otherwise it's already visible). */
  markUnread: () => void;
}

export const useRightSidebarStore = create<RightSidebarState>()(
  persist(
    (set, get) => ({
      widthFraction: DEFAULT_WIDTH_FRACTION,
      // Default collapsed — the right panel opens on demand via the header toggle
      // or a pinned tool tab, keeping the chat full-width until the user wants tools.
      collapsed: true,
      unread: false,
      setWidthFraction: fraction => set({ widthFraction: clampFraction(fraction) }),
      setCollapsed: collapsed => set(collapsed ? { collapsed } : { collapsed, unread: false }),
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
      version: 2,
      // v0 persisted an absolute `widthPx`; convert it to a fraction of the
      // window width so existing users keep a comparable starting size.
      // v2 drops the obsolete `activeTab` field (now handled by rightWorkspaceStore).
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<RightSidebarState> & {
          widthPx?: number;
          activeTab?: unknown;
        };
        let result = { ...state };
        if (version < 1 && typeof state.widthPx === 'number') {
          const ref = typeof window !== 'undefined' ? window.innerWidth : 1460;
          const { widthPx, ...rest } = result as typeof result & { widthPx?: number };
          result = { ...rest, widthFraction: clampFraction((widthPx ?? 0) / ref) };
        }
        // Drop obsolete activeTab regardless of version
        const { activeTab: _dropped, ...clean } = result as typeof result & { activeTab?: unknown };
        return clean as RightSidebarState;
      },
      partialize: state => ({
        widthFraction: state.widthFraction,
        collapsed: state.collapsed,
      }),
    }
  )
);

export const RIGHT_SIDEBAR_LIMITS = {
  MIN_WIDTH_PX,
  MIN_WIDTH_FRACTION,
  MAX_WIDTH_FRACTION,
  DEFAULT_WIDTH_FRACTION,
};
