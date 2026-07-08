import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function Chip({
  label,
  icon,
  onRemove,
}: {
  label: string;
  icon?: ReactNode;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/40 px-3 py-1.5 text-xs">
      {icon}
      {label}
      {onRemove && (
        <button
          type="button"
          aria-label={`remove ${label}`}
          onClick={onRemove}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      )}
    </span>
  );
}
