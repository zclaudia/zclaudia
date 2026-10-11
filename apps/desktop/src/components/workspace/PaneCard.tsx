import type { ComponentPropsWithoutRef } from 'react';

interface PaneCardProps extends ComponentPropsWithoutRef<'div'> {
  focused?: boolean;
}

/** Shared surface for persistent workspace and chat panes. */
export function PaneCard({ focused = false, className = '', children, ...props }: PaneCardProps) {
  return (
    <div
      {...props}
      className={`flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden rounded-lg border bg-card transition-shadow ${
        focused ? 'border-muted-foreground/30 shadow-md' : 'border-border/50 shadow-sm'
      } ${className}`.trim()}
    >
      {children}
    </div>
  );
}
