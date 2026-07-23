export interface FilterChip {
  key: string;
  label: string;
  online?: boolean;
}

export function FilterChips({
  chips,
  activeKey,
  onSelect,
}: {
  chips: FilterChip[];
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map(c => {
        const active = c.key === activeKey;
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(c.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors ${
              active
                ? 'bg-primary/10 text-primary'
                : 'border border-border/60 bg-secondary/30 text-muted-foreground hover:bg-secondary/50'
            }`}
          >
            {c.online !== undefined && (
              <span
                className={`h-1.5 w-1.5 rounded-full ${c.online ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`}
              />
            )}
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
