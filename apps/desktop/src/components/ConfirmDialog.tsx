// Global host for the in-app confirm/prompt primitive (see confirmDialogStore).
// Mounted once per window in WindowShell so `confirm()` / `promptText()` work
// from anywhere — including popped-out standalone windows.

import { useEffect, useRef, useState } from 'react';
import { useConfirmDialogStore } from '../stores/confirmDialogStore';

export function ConfirmDialog() {
  const current = useConfirmDialogStore(s => s.current);
  const confirm = useConfirmDialogStore(s => s.confirm);
  const cancel = useConfirmDialogStore(s => s.cancel);

  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Reset the input and move focus when a new request opens.
  useEffect(() => {
    if (!current) return;
    setInputValue(current.input?.defaultValue ?? '');
    const id = setTimeout(() => {
      if (current.input) {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else {
        confirmBtnRef.current?.focus();
      }
    }, 0);
    return () => clearTimeout(id);
  }, [current]);

  if (!current) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && current.input) {
      // For confirm-mode (no input) the focused button handles Enter natively.
      e.preventDefault();
      confirm(inputValue);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]"
      onMouseDown={e => {
        // Backdrop click cancels; ignore clicks that bubble from the panel.
        if (e.target === e.currentTarget) cancel();
      }}
      onKeyDown={onKeyDown}
      role="presentation"
    >
      <div
        className="bg-popover border border-border rounded-xl shadow-lg max-w-md w-full mx-4"
        role="dialog"
        aria-modal="true"
        aria-label={current.title}
      >
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-base font-semibold">{current.title}</h3>
        </div>
        <div className="px-4 py-3 space-y-3 text-sm">
          {current.message && (
            <p className="text-muted-foreground whitespace-pre-line">{current.message}</p>
          )}
          {current.input && (
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              placeholder={current.input.placeholder}
              className="w-full px-2.5 py-1.5 text-sm rounded-md bg-input border border-border focus:outline-none focus:ring-1 focus:ring-ring"
            />
          )}
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            className="px-3 py-1.5 text-sm rounded-md bg-secondary hover:bg-secondary/80"
            onClick={() => cancel()}
          >
            {current.cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={
              current.destructive
                ? 'px-3 py-1.5 text-sm rounded-md bg-red-500/90 text-white hover:bg-red-500'
                : 'px-3 py-1.5 text-sm rounded-md bg-muted/60 text-foreground hover:bg-muted'
            }
            onClick={() => confirm(inputValue)}
          >
            {current.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
