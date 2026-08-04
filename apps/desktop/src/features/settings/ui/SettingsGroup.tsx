import type { ReactNode } from 'react';

/** A labeled group of settings rows: label over a soft borderless divided card. */
export function SettingsGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section>
      {label && (
        <h4 className="mb-2 ml-0.5 text-xs font-medium tracking-wide text-muted-foreground">
          {label}
        </h4>
      )}
      <div className="divide-y divide-border rounded-xl bg-secondary/30">{children}</div>
    </section>
  );
}

/** One settings row: leading icon + title/description on the left, a control on the right,
 *  and an optional full-width body below. */
export function SettingsRow({
  icon,
  title,
  description,
  control,
  children,
  align = 'center',
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  align?: 'center' | 'start';
}) {
  return (
    <div className="p-4">
      <div
        className={`flex flex-col gap-3 md:flex-row ${align === 'start' ? 'md:items-start' : 'md:items-center'} md:justify-between`}
      >
        <div className="flex min-w-0 items-center gap-3">
          {icon && <span className="flex-shrink-0 text-muted-foreground">{icon}</span>}
          <div className="min-w-0">
            <div className="text-sm">{title}</div>
            {description && (
              <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
            )}
          </div>
        </div>
        {control && <div className="flex items-center gap-2 md:flex-shrink-0">{control}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
