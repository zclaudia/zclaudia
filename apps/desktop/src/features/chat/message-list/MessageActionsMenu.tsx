import { useState, useRef, useEffect } from 'react';
import { MoreHorizontal, GitFork, GitBranch } from 'lucide-react';

/**
 * Small floating action menu shown on hover for messages that carry a `treeEntryId`.
 * Provides "Fork into new session" and "Branch from here (rewind)" SP-A actions.
 */
export function MessageActionsMenu({
  treeEntryId,
  onFork,
  onBranch,
  anchor = 'right',
  canBranch = true,
}: {
  treeEntryId: string;
  onFork: (treeEntryId: string) => void;
  onBranch: (treeEntryId: string) => void;
  /** Which edge of the trigger the dropdown aligns to. 'left' opens rightward, 'right' opens leftward. */
  anchor?: 'left' | 'right';
  /** False for the current leaf (latest message), where a rewind would be a no-op. */
  canBranch?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={e => {
          e.stopPropagation();
          setOpen(v => !v);
        }}
        className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
        title="Message actions"
        aria-label="Message actions"
      >
        <MoreHorizontal size={14} strokeWidth={1.75} />
      </button>

      {open && (
        <div
          className={`absolute ${anchor === 'left' ? 'left-0' : 'right-0'} bottom-7 z-50 min-w-[200px] rounded-xl border border-border bg-popover shadow-md py-1 text-sm`}
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/60 transition-colors"
            onClick={e => {
              e.stopPropagation();
              setOpen(false);
              onFork(treeEntryId);
            }}
          >
            <GitFork size={14} strokeWidth={1.75} className="flex-shrink-0 text-muted-foreground" />
            <span>Fork into new session</span>
          </button>
          <button
            disabled={!canBranch}
            title={
              canBranch ? undefined : 'Already at the latest point — branch from an earlier message'
            }
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            onClick={e => {
              e.stopPropagation();
              if (!canBranch) return;
              setOpen(false);
              onBranch(treeEntryId);
            }}
          >
            <GitBranch
              size={14}
              strokeWidth={1.75}
              className="flex-shrink-0 text-muted-foreground"
            />
            <span>Branch from here (rewind)</span>
          </button>
        </div>
      )}
    </div>
  );
}
