import type { ReactNode } from 'react';

/** A labeled group of debug sections rendered as a bordered card with divided rows. */
export function DebugGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 ml-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </h4>
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

/** One section row inside a DebugGroup: header (title + description + actions) over optional body. */
export function DebugSection({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm">{title}</div>
          {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="flex flex-shrink-0 gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
