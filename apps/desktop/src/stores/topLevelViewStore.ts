import { create } from 'zustand';
import type { SettingsTab } from '../features/settings/settingsTabDefs';

export type TopLevelView =
  | { kind: 'app' }
  | { kind: 'settings'; initialTab?: SettingsTab };

interface TopLevelViewState {
  view: TopLevelView;
  openSettings: (initialTab?: SettingsTab) => void;
  returnToApp: () => void;
}

export const useTopLevelViewStore = create<TopLevelViewState>((set) => ({
  view: { kind: 'app' },
  openSettings: (initialTab) => set({
    view: initialTab ? { kind: 'settings', initialTab } : { kind: 'settings' },
  }),
  returnToApp: () => set({ view: { kind: 'app' } }),
}));
