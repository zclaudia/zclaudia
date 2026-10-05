import { create } from 'zustand';

/**
 * Single source of truth for the task-center popover's open state. Both
 * entry points — the SessionHeader pill and the chat-bottom ambient strip —
 * drive this flag, so they can never disagree about whether the popover is
 * up. The future right-panel mount (P3) ignores this entirely: the panel is
 * always "open" by virtue of being mounted.
 */
interface TaskCenterUiState {
  popoverOpen: boolean;
  setPopoverOpen: (open: boolean) => void;
  togglePopover: () => void;
}

export const useTaskCenterUiStore = create<TaskCenterUiState>(set => ({
  popoverOpen: false,
  setPopoverOpen: open => set({ popoverOpen: open }),
  togglePopover: () => set(state => ({ popoverOpen: !state.popoverOpen })),
}));
