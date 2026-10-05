import { useMemo } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useSessionsStore } from '../../stores/sessionsStore';
import { useIsMobile } from '../../hooks/useMediaQuery';
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
  };

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
      <TaskPill runningCount={viewModel.runningCount} open={open} onToggle={toggle} />
      <TaskCenterPopover open={open} onClose={() => setOpen(false)} {...viewProps} />
    </div>
  );
}
