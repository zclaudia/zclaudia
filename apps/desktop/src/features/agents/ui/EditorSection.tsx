import type { ReactNode } from 'react';

export function EditorSection({
  title,
  description,
  children,
  flush = false,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** When true, render children edge-to-edge (for divided EditorRows) instead
   *  of the default padded `space-y-3` stack. */
  flush?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-secondary/25 shadow-apple-sm">
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
}: {
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  align?: 'center' | 'start';
}) {
  return (
    <div className="px-4 py-3">
      <div
        className={`flex ${align === 'start' ? 'items-start' : 'items-center'} justify-between gap-3`}
      >
        <div className="min-w-0">
          <div className="text-sm text-foreground">{title}</div>
          {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
        </div>
        {control && <div className="flex flex-shrink-0 items-center gap-2">{control}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
