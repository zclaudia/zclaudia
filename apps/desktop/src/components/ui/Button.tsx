import { forwardRef, type ButtonHTMLAttributes } from 'react';

/**
 * Canonical button primitive.
 *
 * Seed styles come from the app's most-repeated recipes: `primary` is the
 * modal-footer recipe that was duplicated verbatim across five modals, and
 * `ghost` is its Cancel sibling. Standardizations applied while extracting:
 * one radius (rounded-md, per the ui-conventions row language), one disabled
 * treatment (opacity-50 + pointer-events guard), a focus-visible ring on every
 * variant, and transition-colors everywhere.
 */
type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'destructive';
type ButtonSize = 'sm' | 'md';

const BASE =
  'inline-flex select-none items-center justify-center gap-1.5 font-medium ' +
  'rounded-md transition-colors outline-none ' +
  'focus-visible:ring-1 focus-visible:ring-ring ' +
  'disabled:pointer-events-none disabled:opacity-50';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground shadow-apple-sm hover:bg-primary/90',
  ghost: 'text-muted-foreground hover:bg-secondary hover:text-foreground',
  outline: 'border border-border text-foreground hover:bg-secondary',
  destructive: 'text-destructive hover:bg-destructive/10',
};

/* h-7 matches the chrome row height; text tiers follow the composer (11px)
 * and modal-footer (13px) sizes already in use. */
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-6 max-md:h-9 px-2 text-[11px]',
  md: 'h-7 max-md:h-9 px-3 text-[13px]',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', className = '', type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`.trim()}
      {...rest}
    />
  );
});

/**
 * Square ghost icon button. Replaces the hand-rolled
 * `p-1/p-1.5 rounded(-md) text-muted-foreground hover:…` recipes; hover fill is
 * standardized on bg-secondary (the documented chrome hover fill).
 */
interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
  /** Required: icon-only controls are invisible to screen readers without it. */
  'aria-label': string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'md', className = '', type = 'button', ...rest },
  ref
) {
  const dim = size === 'sm' ? 'h-6 w-6' : 'h-7 w-7';
  return (
    <button
      ref={ref}
      type={type}
      className={`${BASE} ${VARIANT.ghost} ${dim} shrink-0 relative before:absolute before:-inset-1.5 before:content-[''] md:before:content-none ${className}`.trim()}
      {...rest}
    />
  );
});
