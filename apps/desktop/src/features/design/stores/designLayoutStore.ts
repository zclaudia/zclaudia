import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type DesignLeftTab = 'pages' | 'layers' | 'library' | 'slides';
export type DesignLibraryTab = 'assets' | 'templates' | 'brand' | 'media';
export type DesignRightTab = 'design' | 'styles' | 'history';

export interface DesignLayoutPrefs {
  leftOpen: boolean;
  leftTab: DesignLeftTab;
  libraryTab: DesignLibraryTab;
  leftWidth: number;
  rightOpen: boolean;
  rightTab: DesignRightTab;
  collapsedSections: Record<string, boolean>;
}

interface DesignLayoutState extends DesignLayoutPrefs {
  setLeftOpen(open: boolean): void;
  toggleLeft(): void;
  setLeftTab(tab: DesignLeftTab): void;
  setLibraryTab(tab: DesignLibraryTab): void;
  setLeftWidth(px: number): void;
  setRightOpen(open: boolean): void;
  toggleRight(): void;
  setRightTab(tab: DesignRightTab): void;
  /** Write the collapsed flag explicitly. Missing keys are not "open" — callers apply section defaults. */
  setSectionCollapsed(id: string, collapsed: boolean): void;
  resetLayout(): void;
}

export const DESIGN_LEFT_WIDTH_MIN = 200;
export const DESIGN_LEFT_WIDTH_MAX = 420;

const defaultPrefs = (): DesignLayoutPrefs => ({
  leftOpen: true,
  leftTab: 'pages',
  libraryTab: 'assets',
  leftWidth: 240,
  rightOpen: true,
  rightTab: 'design',
  collapsedSections: {},
});

/** Persisted layout preferences for the design workbench (left/right panels, tabs, collapsed sections). */
export const useDesignLayoutStore = create<DesignLayoutState>()(
  persist(
    set => ({
      ...defaultPrefs(),
      setLeftOpen: open => set({ leftOpen: open }),
      toggleLeft: () => set(state => ({ leftOpen: !state.leftOpen })),
      setLeftTab: tab => set({ leftTab: tab }),
      setLibraryTab: tab => set({ libraryTab: tab }),
      setLeftWidth: px =>
        set({
          leftWidth: Math.min(
            DESIGN_LEFT_WIDTH_MAX,
            Math.max(DESIGN_LEFT_WIDTH_MIN, Math.round(px))
          ),
        }),
      setRightOpen: open => set({ rightOpen: open }),
      toggleRight: () => set(state => ({ rightOpen: !state.rightOpen })),
      setRightTab: tab => set({ rightTab: tab }),
      setSectionCollapsed: (id, collapsed) =>
        set(state => ({
          collapsedSections: { ...state.collapsedSections, [id]: collapsed },
        })),
      resetLayout: () => set(defaultPrefs()),
    }),
    {
      name: 'zclaudia-design-layout-v1',
      version: 1,
      partialize: (state): DesignLayoutPrefs => ({
        leftOpen: state.leftOpen,
        leftTab: state.leftTab,
        libraryTab: state.libraryTab,
        leftWidth: state.leftWidth,
        rightOpen: state.rightOpen,
        rightTab: state.rightTab,
        collapsedSections: state.collapsedSections,
      }),
    }
  )
);
