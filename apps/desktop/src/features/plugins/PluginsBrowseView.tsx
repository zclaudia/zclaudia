import { useMemo, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import type { PluginCardModel } from './plugins-types';
import { PluginCard } from './ui/PluginCard';

function filterModels(models: PluginCardModel[], q: string) {
  if (!q) return models;
  const needle = q.toLowerCase();
  return models.filter(
    m => m.title.toLowerCase().includes(needle) || m.pluginId.toLowerCase().includes(needle)
  );
}

/**
 * A single Extensions tab: a titled header with search (and an optional
 * "Add directory" action) over a card grid, or a dashed empty state.
 * Both the Built-in and Plugins tabs render through this with different props.
 */
export function PluginsBrowseView({
  title,
  models,
  kind,
  onToggle,
  emptyText,
  searchPlaceholder,
  onAddDirectory,
}: {
  title: string;
  models: PluginCardModel[];
  kind: 'Built-in' | 'Installed';
  onToggle: (id: string) => void;
  emptyText: string;
  searchPlaceholder: string;
  /** When provided, an "Add directory" button renders in the header. */
  onAddDirectory?: () => void;
}) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterModels(models, query.trim()), [models, query]);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h1 className="text-sm font-medium">{title}</h1>
        <span className="text-[11px] text-muted-foreground">{models.length}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/30 px-3 py-1.5 text-xs text-muted-foreground">
            <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-32 bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </div>
          {onAddDirectory && (
            <button
              type="button"
              onClick={onAddDirectory}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-secondary"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} /> Add directory
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 p-5 text-center text-xs text-muted-foreground">
            {query.trim() ? 'Nothing matches your search.' : emptyText}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {visible.map(m => (
              <PluginCard key={m.id} model={m} kind={kind} onToggle={() => onToggle(m.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
