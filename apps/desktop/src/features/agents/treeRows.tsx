import type { ReactNode } from 'react';

/** Muted informational row used for loading/error/empty states inside a backend group. */
export function TreeInfoRow({ children }: { children: ReactNode }) {
  return <div className="px-2 text-xs text-muted-foreground/60">{children}</div>;
}

/** Row class for selectable tree items. */
export function treeRowClass(selected: boolean): string {
  return `w-full text-left h-7 px-2 rounded-md text-xs flex items-center gap-1.5 transition-colors ${
    selected
      ? 'bg-secondary text-foreground'
      : 'hover:bg-secondary hover:text-foreground text-muted-foreground'
  }`;
}
