import { useMemo, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import type { AgentsBackend, AgentsTab, LibraryItem } from './agents-types';
import { ItemCard } from './ui/ItemCard';
import { FilterChips } from './ui/FilterChips';

const TAB_TITLE: Record<AgentsTab, string> = {
  all: 'All items',
  profiles: 'Agent Profiles',
  skills: 'Skills',
  'mcp-servers': 'MCP Servers',
  providers: 'LLM Providers',
};

export function BrowseView({
  tab,
  backendFilter,
  backends,
  items,
  onOpen,
  onSelectBackendFilter,
  onNew,
}: {
  tab: AgentsTab;
  backendFilter: string;
  backends: AgentsBackend[];
  items: LibraryItem[];
  onOpen: (item: LibraryItem) => void;
  onSelectBackendFilter: (key: string) => void;
  onNew: () => void;
}) {
  const [query, setQuery] = useState('');
  const byName = useMemo(
    () => new Map(backends.map(b => [b.backendId, b])),
    [backends]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      i =>
        i.title.toLowerCase().includes(q) ||
        (i.subtitle ?? '').toLowerCase().includes(q)
    );
  }, [items, query]);

  const chips = [
    { key: 'all', label: 'All' },
    ...backends.map(b => ({ key: b.backendId, label: b.name, online: b.online })),
  ];

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-medium">{TAB_TITLE[tab]}</h1>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/30 px-3 py-1.5 text-xs text-muted-foreground">
              <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-28 bg-transparent outline-none placeholder:text-muted-foreground"
              />
            </div>
            <button
              type="button"
              onClick={onNew}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-secondary"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} /> New
            </button>
          </div>
        </div>
        {(backends.length > 1 || backendFilter !== 'all') && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Backend</span>
            <FilterChips chips={chips} activeKey={backendFilter} onSelect={onSelectBackendFilter} />
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
          <p className="text-sm">Nothing here yet</p>
          <p className="mt-1 text-xs opacity-60">Create one with New.</p>
        </div>
      ) : (
        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto p-4 lg:grid-cols-3">
          {visible.map(item => {
            const b = byName.get(item.backendId);
            return (
              <ItemCard
                key={`${item.backendId}:${item.kind}:${item.id}`}
                item={item}
                backendName={b?.name ?? item.backendId}
                backendOnline={b?.online ?? false}
                onOpen={() => onOpen(item)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
