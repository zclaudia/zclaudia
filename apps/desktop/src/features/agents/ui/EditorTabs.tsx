export interface EditorTab {
  id: string;
  label: string;
  count?: number;
}

export function EditorTabs({
  tabs,
  active,
  onChange,
  variant = 'primary',
}: {
  tabs: EditorTab[];
  active: string;
  onChange: (id: string) => void;
  variant?: 'primary' | 'sub';
}) {
  const isSub = variant === 'sub';
  return (
    <div
      role="tablist"
      data-variant={variant}
      className={
        isSub
          ? 'flex gap-1 rounded-md bg-secondary/30 p-0.5'
          : 'flex gap-1 rounded-lg border border-border bg-secondary/40 p-1'
      }
    >
      {tabs.map(tab => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md font-medium transition-colors ${
              isSub ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
            } ${
              selected
                ? 'bg-card text-foreground shadow-apple-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="text-[10px] text-muted-foreground">{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
