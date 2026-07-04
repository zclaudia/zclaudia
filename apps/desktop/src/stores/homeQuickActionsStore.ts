import { create } from 'zustand';

export type HomeQuickAction = 'new-session' | 'new-project';

interface HomeQuickActionsState {
  pending: HomeQuickAction | null;
  /** Ask the Sidebar to open the corresponding flow (it consumes via effect). */
  request: (action: HomeQuickAction) => void;
  consume: () => HomeQuickAction | null;
}

/** Bridge for Home-page quick actions into the Sidebar's modal flows. */
export const useHomeQuickActionsStore = create<HomeQuickActionsState>((set, get) => ({
  pending: null,
  request: action => set({ pending: action }),
  consume: () => {
    const action = get().pending;
    if (action) set({ pending: null });
    return action;
  },
}));
