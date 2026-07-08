import { useMemo, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import type { PluginCardModel } from './plugins-types';
import { PluginCard } from './ui/PluginCard';
import { PluginSection } from './ui/PluginSection';

function filterModels(models: PluginCardModel[], q: string) {
  if (!q) return models;
  const needle = q.toLowerCase();
  return models.filter(
    m =>
      m.title.toLowerCase().includes(needle) ||
      m.pluginId.toLowerCase().includes(needle)
  );
}

export function PluginsBrowseView({
  builtin,
  installed,
  onToggleBuiltin,
  onToggleInstalled,
  onAddDirectory,
}: {
  builtin: PluginCardModel[];
  installed: PluginCardModel[];
  onToggleBuiltin: (id: string) => void;
  onToggleInstalled: (id: string) => void;
  onAddDirectory: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim();
  const visibleBuiltin = useMemo(() => filterModels(builtin, q), [builtin, q]);
  const visibleInstalled = useMemo(() => filterModels(installed, q), [installed, q]);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h1 className="text-sm font-medium">Plugins</h1>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/30 px-3 py-1.5 text-xs text-muted-foreground">
            <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search plugins…"
              className="w-32 bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </div>
          <button
            type="button"
            onClick={onAddDirectory}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-secondary"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} /> Add directory
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <PluginSection label="Built-in" count={visibleBuiltin.length}>
          {visibleBuiltin.map(m => (
            <PluginCard key={m.id} model={m} kind="Built-in" onToggle={() => onToggleBuiltin(m.id)} />
          ))}
        </PluginSection>

        <PluginSection
          label="Installed"
          count={visibleInstalled.length}
          isEmpty={visibleInstalled.length === 0}
          emptyText={
            q
              ? 'No installed plugins match your search.'
              : 'No plugins installed. Add a plugin directory to get started.'
          }
        >
          {visibleInstalled.map(m => (
            <PluginCard
              key={m.id}
              model={m}
              kind="Installed"
              onToggle={() => onToggleInstalled(m.id)}
            />
          ))}
        </PluginSection>
      </div>
    </div>
  );
}
