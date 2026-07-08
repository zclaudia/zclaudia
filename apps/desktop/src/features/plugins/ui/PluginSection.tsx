import type { ReactNode } from 'react';

export function PluginSection({
  label,
  count,
  isEmpty,
  emptyText,
  children,
}: {
  label: string;
  count: number;
  isEmpty?: boolean;
  emptyText?: string;
  children?: ReactNode;
}) {
  return (
    <section className="mb-2">
      <div className="px-1 pb-1.5 pt-1">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {`${label} · ${count}`}
        </span>
      </div>
      {isEmpty ? (
        <div className="rounded-xl border border-dashed border-border/70 p-5 text-center text-xs text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{children}</div>
      )}
    </section>
  );
}
