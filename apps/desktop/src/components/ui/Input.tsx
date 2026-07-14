import { forwardRef, type InputHTMLAttributes } from 'react';

/** One field grammar for the whole app. Semantic tokens + a single
 *  focus-visible ring. Reused by textareas/selects via FIELD_CLASS. */
export const FIELD_CLASS =
  'w-full rounded-md border border-input bg-background/70 px-2.5 py-1.5 text-sm text-foreground ' +
  'placeholder:text-muted-foreground outline-none transition-colors ' +
  'focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring ' +
  'disabled:opacity-50 aria-[invalid=true]:border-destructive';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...props }, ref) {
    return <input ref={ref} className={`${FIELD_CLASS} ${className}`.trim()} {...props} />;
  },
);
