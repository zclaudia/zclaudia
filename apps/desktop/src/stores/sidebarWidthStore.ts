import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const DEFAULT_WIDTH_PX = 256;
const MIN_WIDTH_PX = 200;
const MAX_WIDTH_VW = 30;

interface SidebarWidthState {
  widthPx: number;
  setWidth: (px: number) => void;
}

/** Persisted width for the resizable left sidebar (mirrors the right sidebar). */
export const useSidebarWidthStore = create<SidebarWidthState>()(
  persist(
    set => ({
      widthPx: DEFAULT_WIDTH_PX,
      setWidth: px => {
        const maxPx =
          (typeof window !== 'undefined' ? window.innerWidth : 1920) * (MAX_WIDTH_VW / 100);
        set({ widthPx: Math.max(MIN_WIDTH_PX, Math.min(maxPx, px)) });
      },
    }),
    {
      name: 'claudia-left-sidebar',
      partialize: state => ({ widthPx: state.widthPx }),
    }
  )
);

export const SIDEBAR_WIDTH_LIMITS = {
  MIN_WIDTH_PX,
  MAX_WIDTH_VW,
  DEFAULT_WIDTH_PX,
};
