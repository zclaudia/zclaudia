import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Badge } from './Badge';

export interface DetailBadge {
  label: string;
  tone?: 'accent' | 'neutral';
  online?: boolean;
  /**
   * Context rather than a signal — which backend the record lives on, whether
   * it is the default. `ProfileHeader` hides these below `md`, where a stack of
   * non-actionable chips pushed the header to three lines. Anything the user
   * may need to act on (read-only, an unhealthy record) must stay primary.
   */
  secondary?: boolean;
}

export function DetailHeader({
  crumb,
  title,
  badges = [],
  onBack,
  actions,
}: {
  crumb: string;
  title: string;
  badges?: DetailBadge[];
  onBack: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} /> {crumb}
      </button>
      <span className="text-muted-foreground">/</span>
      <h1 className="truncate text-sm font-medium text-foreground">{title}</h1>
      {badges.map(b => (
        <Badge key={b.label} label={b.label} tone={b.tone} online={b.online} />
      ))}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}
