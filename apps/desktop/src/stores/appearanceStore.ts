import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppearanceState {
  chatCard: boolean;
  unifiedWorkspace: boolean;
  setChatCard: (enabled: boolean) => void;
  setUnifiedWorkspace: (enabled: boolean) => void;
}

/** Desktop experiments are opt-in; each can be disabled independently. */
export const useAppearanceStore = create<AppearanceState>()(
  persist(
    set => ({
      chatCard: false,
      unifiedWorkspace: false,
      setChatCard: chatCard => set({ chatCard }),
      setUnifiedWorkspace: unifiedWorkspace => set({ unifiedWorkspace }),
    }),
    {
      name: 'claudia-appearance',
      partialize: state => ({
        chatCard: state.chatCard,
        unifiedWorkspace: state.unifiedWorkspace,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<AppearanceState> | undefined;
        return {
          ...current,
          chatCard: typeof saved?.chatCard === 'boolean' ? saved.chatCard : false,
          unifiedWorkspace:
            typeof saved?.unifiedWorkspace === 'boolean' ? saved.unifiedWorkspace : false,
        };
      },
    }
  )
);
