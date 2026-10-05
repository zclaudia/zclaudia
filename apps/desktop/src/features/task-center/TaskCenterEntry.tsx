import { useEffect, useMemo } from 'react';
import type { BackgroundTask } from '../../stores/backgroundTaskStore';
import { useServerStore } from '../../stores/serverStore';
import { useSessionsStore } from '../../stores/sessionsStore';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useSelectionCoordinator } from '../../hooks/useSelectionCoordinator';
import { TaskPill } from './TaskPill';
import { TaskCenterPopover } from './TaskCenterPopover';
import { TaskCenterView } from './TaskCenterView';
import { useTaskCenter } from './useTaskCenter';
import { useTaskCenterUiStore } from './taskCenterUiStore';

/**
 * Assembles the task-center entry for the SessionHeader: the L1 pill plus
 * its containers. Desktop gets the anchored popover; mobile (<md, where the
 * pill is hidden and the ambient strip is the entry point) gets a fixed
 * overlay — the same split pattern SessionHeader uses for session info.
 * ChatInterface passes this into SessionHeader as a slot so the header stays
 * free of connection/store coupling (and its tests keep rendering without a
 * ConnectionProvider).
 */
export function TaskCenterEntry({ sessionId }: { sessionId: string }) {
  const activeServerId = useServerStore(s => s.activeServerId);
  const viewModel = useTaskCenter(activeServerId ?? undefined);
  const open = useTaskCenterUiStore(s => s.popoverOpen);
  const setOpen = useTaskCenterUiStore(s => s.setPopoverOpen);
  const toggle = useTaskCenterUiStore(s => s.togglePopover);
  const remoteSessions = useSessionsStore(s => s.remoteSessions);
  // Render exactly one container: gating on the breakpoint (not just CSS
  // hiding) keeps a single role=dialog in the DOM — two hidden copies confuse
  // screen readers and text-based lookups alike.
  const isMobile = useIsMobile();
  const { selectSession } = useSelectionCoordinator();

  const resolveSessionLabel = useMemo(() => {
    const names = new Map<string, string>();
    for (const sessions of remoteSessions.values()) {
      for (const session of sessions) {
        if (session.name) names.set(session.id, session.name);
      }
    }
    return (id: string) => names.get(id);
  }, [remoteSessions]);

  const viewProps = {
    groups: viewModel.groups,
    hasTerminalTasks: viewModel.hasTerminalTasks,
    currentSessionId: sessionId,
    resolveSessionLabel,
    onStop: viewModel.stopTask,
    onDismiss: viewModel.dismissTask,
    onClearFinished: viewModel.clearFinished,
    onLocate: (task: BackgroundTask) => {
      // Pass the owning backend so the jump lands on the right server even
      // when that backend's session list isn't loaded.
      selectSession(task.sessionId, { backendId: task.serverId });
      setOpen(false);
    },
    // The drawer outlives the popover: opening it closes the popover (the
    // ui store's openDrawer does both), and the drawer mounts app-side.
    onViewSubagent: (task: BackgroundTask) => {
      useTaskCenterUiStore.getState().openDrawer(task.id);
    },
  };

  // Same Escape contract as the desktop popover: the mobile backdrop is
  // click-only, so the overlay needs a window-level listener while mounted.
  useEffect(() => {
    if (!(isMobile && open)) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobile, open, setOpen]);

  if (isMobile) {
    return open ? (
      <div>
        <div
          className="fixed inset-0 z-modal bg-black/40"
          onClick={() => setOpen(false)}
        />
        <div
          role="dialog"
          aria-label="Task center"
          className="fixed inset-x-3 top-[calc(env(safe-area-inset-top,0px)+56px)] z-modal overflow-hidden rounded-xl border border-border/80 bg-popover shadow-xl"
        >
          <div className="max-h-[60vh] overflow-y-auto">
            <TaskCenterView {...viewProps} onClose={() => setOpen(false)} />
          </div>
        </div>
      </div>
    ) : null;
  }

  return (
    <div className="relative shrink-0">
      <TaskPill
        runningCount={viewModel.runningCount}
        finishedCount={viewModel.groups.terminal.length}
        open={open}
        onToggle={toggle}
      />
      <TaskCenterPopover open={open} onClose={() => setOpen(false)} {...viewProps} />
    </div>
  );
}
