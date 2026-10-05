import { useEffect } from 'react';
import { TaskCenterView, type TaskCenterViewProps } from './TaskCenterView';

interface TaskCenterPopoverProps extends TaskCenterViewProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Container A for the task center: a popover anchored under the header pill.
 * Replicates the SessionHeader info-popover pattern (backdrop click shield +
 * absolutely positioned panel) but uses the z-dropdown token per
 * ui-conventions §8 instead of the legacy z-[70]/z-[80] arbitrary values.
 * Height constraint lives here, never in TaskCenterView.
 */
export function TaskCenterPopover({ open, onClose, ...viewProps }: TaskCenterPopoverProps) {
  // The backdrop shield is click-only, so Escape needs its own window-level
  // listener (same contract as TaskDrawer's).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-dropdown" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Task center"
        className="absolute right-0 top-full z-dropdown mt-1.5 w-[380px] max-w-[90vw] overflow-hidden rounded-xl border border-border/80 bg-popover shadow-xl"
      >
        <div className="max-h-[60vh] overflow-y-auto">
          <TaskCenterView {...viewProps} />
        </div>
      </div>
    </>
  );
}
