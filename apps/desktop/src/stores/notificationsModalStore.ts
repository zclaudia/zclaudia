import { create } from 'zustand';

/**
 * Open/closed state for the desktop Notifications popup — an independent
 * centered overlay (modeled on SearchModal), decoupled from the notch panel.
 * A store rather than local state because multiple desktop bells trigger it
 * and the modal is rendered once at the app root.
 */
interface NotificationsModalState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useNotificationsModalStore = create<NotificationsModalState>(set => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set(s => ({ isOpen: !s.isOpen })),
}));
