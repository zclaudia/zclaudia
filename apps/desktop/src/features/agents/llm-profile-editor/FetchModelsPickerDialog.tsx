import { useEffect, useId, useRef } from 'react';

interface FetchModelsPickerDialogProps {
  candidates: string[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function FetchModelsPickerDialog({
  candidates,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  onCancel,
  onConfirm,
}: FetchModelsPickerDialogProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus the first control (the close button) when the dialog mounts, and
  // wire Escape to close it — the backdrop-click close (below) stays as is.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  // Trap Tab/Shift+Tab focus within the dialog so keyboard users can't tab
  // out into the (visually obscured but still-present) editor behind it.
  const handleTrapKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[60]" onClick={onCancel} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleTrapKeyDown}
        className="fixed inset-4 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[480px] md:max-h-[70vh] bg-card rounded-lg shadow-xl z-[60] flex flex-col border border-border"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 id={titleId} className="text-sm font-semibold">
            Import models from /models
          </h3>
          <button
            ref={closeButtonRef}
            onClick={onCancel}
            className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
            aria-label="Close picker"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-b border-border text-xs text-muted-foreground">
          <span>
            {candidates.length} candidates — {selected.size} selected
          </span>
          <div className="flex gap-2">
            <button onClick={onSelectAll} className="hover:text-foreground">
              All
            </button>
            <button onClick={onSelectNone} className="hover:text-foreground">
              None
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {candidates.map(id => (
            <label
              key={id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selected.has(id)}
                onChange={() => onToggle(id)}
                className="rounded-md border-border bg-secondary"
              />
              <span className="text-sm font-mono">{id}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2 p-3 border-t border-border">
          <button
            onClick={onConfirm}
            disabled={selected.size === 0}
            className="flex-1 px-3 py-2 bg-muted/60 text-foreground hover:bg-muted rounded-md text-sm font-medium disabled:opacity-50"
          >
            Add {selected.size} model{selected.size === 1 ? '' : 's'}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-2 bg-secondary hover:bg-secondary/80 rounded-md text-sm font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
