import type { ReactNode } from 'react';

export function EditorSection({
  title,
  description,
  children,
  flush = false,
  overflowVisible = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** When true, render children edge-to-edge (for divided EditorRows) instead
   *  of the default padded `space-y-3` stack. */
  flush?: boolean;
  /** When true, drop `overflow-hidden` so an absolutely-positioned popover in a
   *  row (e.g. a dropdown menu) can escape the section's bounds. The rounded
   *  corners still clip the background/border natively. Use for any section
   *  whose last visible row hosts a dropdown. */
  overflowVisible?: boolean;
}) {
  return (
    <section
      className={`rounded-lg border border-border/60 bg-secondary/25 shadow-apple-sm ${overflowVisible ? '' : 'overflow-hidden'}`}
    >
      <div className="border-b border-border/60 px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {flush ? <div>{children}</div> : <div className="space-y-3 p-4">{children}</div>}
    </section>
  );
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-muted-foreground">
      {children}
    </label>
  );
}

/** One editor row: title/description on the left, a control on the right, and an
 *  optional full-width body below. Sits inside a `flush` EditorSection; the
 *  parent supplies `divide-y` between rows. Modeled on the settings
 *  SettingsRow but sized for the profile editor. */
export function EditorRow({
  title,
  description,
  control,
  children,
  align = 'center',
  layout = 'inline',
}: {
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  align?: 'center' | 'start';
  /**
   * `inline` (default) keeps the label and control side by side at every width.
   * A short label next to a dropdown fits fine on a phone, and stacking every
   * row cost ~95px each — five fields no longer fit on one screen.
   *
   * `stack` drops the control below the label under `md`. Use it for controls
   * that genuinely need the full width (textareas, file paths) or when the
   * row's description is a full sentence.
   */
  layout?: 'inline' | 'stack';
}) {
  const stacked = layout === 'stack';
  // Written out rather than interpolated so Tailwind can see the class names.
  const rowClass = stacked
    ? align === 'start'
      ? 'flex flex-col gap-3 md:flex-row md:items-start md:justify-between'
      : 'flex flex-col gap-3 md:flex-row md:items-center md:justify-between'
    : align === 'start'
      ? 'flex items-start justify-between gap-3'
      : 'flex items-center justify-between gap-3';
  return (
    <div className="px-4 py-3">
      <div className={rowClass}>
        <div className="min-w-0">
          <div className="text-sm text-foreground">{title}</div>
          {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
        </div>
        {control && (
          <div
            className={`flex items-center gap-2 ${stacked ? 'md:flex-shrink-0' : 'flex-shrink-0'}`}
          >
            {control}
          </div>
        )}
      </div>
      {children && <div className="mt-3 empty:hidden">{children}</div>}
    </div>
  );
}
