// In-app confirm/prompt primitive.
//
// `window.confirm` / `window.prompt` are broken in the Tauri webview: they
// resolve falsy/null WITHOUT ever showing a dialog. That silently aborts any
// `if (!window.confirm(...)) return` gate (the action never runs and no error
// surfaces), and makes `window.prompt` always behave as "cancelled". This store
// + the <ConfirmDialog /> host render a real, in-app modal and expose imperative
// helpers that are drop-in replacements:
//
//   const ok = await confirm({ title, message, destructive: true });
//   if (!ok) return;
//
//   const name = await promptText({ title, placeholder: '…' });
//   if (name === null) return; // cancelled
//
// Only one dialog is shown at a time; opening a new one auto-cancels any pending
// request so a caller can never hang.

import { create } from 'zustand';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Confirm button label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Style the confirm button as a destructive (red) action. */
  destructive?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  /** Placeholder text for the input field. */
  placeholder?: string;
  /** Initial value of the input field. */
  defaultValue?: string;
}

interface ActiveRequest {
  id: string;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
  /** Present when the dialog should collect a text value (prompt mode). */
  input?: { placeholder?: string; defaultValue?: string };
  /**
   * Confirm-mode resolves with boolean; prompt-mode resolves with the entered
   * string, or null when cancelled.
   */
  resolve: (result: boolean | string | null) => void;
}

interface ConfirmDialogState {
  current: ActiveRequest | null;
  /** Confirm the active request (button click / Enter). */
  confirm: (value?: string) => void;
  /** Cancel the active request (button click / Escape / backdrop). */
  cancel: () => void;
  /** Internal: enqueue a request, auto-cancelling any already-open one. */
  _open: (req: ActiveRequest) => void;
}

let counter = 0;

export const useConfirmDialogStore = create<ConfirmDialogState>((set, get) => ({
  current: null,

  _open: req => {
    const prev = get().current;
    // Resolve any in-flight dialog as cancelled before showing the new one.
    if (prev) prev.resolve(prev.input ? null : false);
    set({ current: req });
  },

  confirm: value => {
    const cur = get().current;
    if (!cur) return;
    set({ current: null });
    cur.resolve(cur.input ? (value ?? cur.input.defaultValue ?? '') : true);
  },

  cancel: () => {
    const cur = get().current;
    if (!cur) return;
    set({ current: null });
    cur.resolve(cur.input ? null : false);
  },
}));

/**
 * In-app replacement for `window.confirm`. Resolves true if the user confirms,
 * false if they cancel (button, Escape, or backdrop click).
 */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    useConfirmDialogStore.getState()._open({
      id: `confirm-${++counter}`,
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'Confirm',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      destructive: opts.destructive ?? false,
      resolve: r => resolve(r === true),
    });
  });
}

/**
 * In-app replacement for `window.prompt`. Resolves with the entered string
 * (possibly empty) on confirm, or null when cancelled.
 */
export function promptText(opts: PromptOptions): Promise<string | null> {
  return new Promise<string | null>(resolve => {
    useConfirmDialogStore.getState()._open({
      id: `prompt-${++counter}`,
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'OK',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      destructive: opts.destructive ?? false,
      input: { placeholder: opts.placeholder, defaultValue: opts.defaultValue },
      resolve: r => resolve(typeof r === 'string' ? r : null),
    });
  });
}
