import { create } from 'zustand';

/**
 * Single source of truth for the task-center chrome's open state. Both
 * entry points — the SessionHeader pill and the chat-bottom ambient strip —
 * drive the popover flag, so they can never disagree about whether it is
 * up. The drawer flag names one open sub-agent detail drawer; it lives here
 * (rather than in the row that launched it) because the drawer outlives the
 * popover that opened it — the popover closes as the drawer opens. The
 * future right-panel mount (P3) ignores both: the panel is always "open" by
 * virtue of being mounted.
 */
interface TaskCenterUiState {
  popoverOpen: boolean;
  /** Background-task id whose sub-agent detail drawer is open, if any. */
  drawerTaskId: string | null;
  setPopoverOpen: (open: boolean) => void;
  togglePopover: () => void;
  openDrawer: (taskId: string) => void;
  closeDrawer: () => void;
}

export const useTaskCenterUiStore = create<TaskCenterUiState>(set => ({
  popoverOpen: false,
  drawerTaskId: null,
  setPopoverOpen: open => set({ popoverOpen: open }),
  togglePopover: () => set(state => ({ popoverOpen: !state.popoverOpen })),
  openDrawer: taskId => set({ drawerTaskId: taskId, popoverOpen: false }),
  closeDrawer: () => set({ drawerTaskId: null }),
}));
