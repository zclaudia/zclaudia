import { useMemo, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import type { AgentsBackend, AgentsTab, LibraryItem } from './agents-types';
import { ItemCard } from './ui/ItemCard';
import type { ItemCardAction } from './ui/ItemCard';
import { FilterChips } from './ui/FilterChips';

const TAB_TITLE: Record<AgentsTab, string> = {
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
  onSetProfileDefault,
  onDeleteProfile,
  onSetLlmProfileDefault,
  onDeleteLlmProfile,
  onDeleteSkill,
  onDeleteMcpServer,
}: {
  tab: AgentsTab;
  backendFilter: string;
  backends: AgentsBackend[];
  items: LibraryItem[];
  onOpen: (item: LibraryItem) => void;
  onSelectBackendFilter: (key: string) => void;
  onNew: () => void;
  onSetProfileDefault?: (item: LibraryItem) => void;
  onDeleteProfile?: (item: LibraryItem) => void;
  onSetLlmProfileDefault?: (item: LibraryItem) => void;
  onDeleteLlmProfile?: (item: LibraryItem) => void;
  onDeleteSkill?: (item: LibraryItem) => void;
  onDeleteMcpServer?: (item: LibraryItem) => void;
}) {
  const [query, setQuery] = useState('');
  const byName = useMemo(() => new Map(backends.map(b => [b.backendId, b])), [backends]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      i => i.title.toLowerCase().includes(q) || (i.subtitle ?? '').toLowerCase().includes(q)
    );
  }, [items, query]);

  // Group cards by backend (This Device first — `backends` is already ordered)
  // whenever more than one backend is in play and no single backend is picked.
  const showGroups = backends.length > 1 && backendFilter === 'all';

  const groups = useMemo(() => {
    if (!showGroups) return null;
    const byBackend = new Map<string, LibraryItem[]>();
    for (const item of visible) {
      const list = byBackend.get(item.backendId);
      if (list) list.push(item);
      else byBackend.set(item.backendId, [item]);
    }
    const ordered: { backend: AgentsBackend; items: LibraryItem[] }[] = [];
    for (const b of backends) {
      const list = byBackend.get(b.backendId);
      if (list) ordered.push({ backend: b, items: list });
    }
    // Items from a backend missing from the list still get a group, at the end.
    for (const [backendId, list] of byBackend) {
      if (!byName.has(backendId)) {
        ordered.push({ backend: { backendId, name: backendId, online: false }, items: list });
      }
    }
    return ordered;
  }, [showGroups, visible, backends, byName]);

  const chips = [
    { key: 'all', label: 'All' },
    ...backends.map(b => ({ key: b.backendId, label: b.name, online: b.online })),
  ];

  const gridClass = 'grid auto-rows-min grid-cols-2 gap-3 lg:grid-cols-3';

  const actionsFor = (item: LibraryItem): ItemCardAction[] | undefined => {
    switch (item.kind) {
      case 'profile':
        return [
          {
            label: 'Set as default agent',
            onSelect: () => onSetProfileDefault?.(item),
            disabled: item.isDefault,
          },
          {
            label: 'Delete agent',
            onSelect: () => onDeleteProfile?.(item),
            destructive: true,
          },
        ];
      case 'llm-profile':
        return [
          {
            label: 'Set as default provider',
            onSelect: () => onSetLlmProfileDefault?.(item),
            disabled: item.isDefault,
          },
          {
            label: 'Delete provider',
            onSelect: () => onDeleteLlmProfile?.(item),
            destructive: true,
          },
        ];
      case 'skill':
        // Source-managed skills (external/plugin) are read-only — no delete.
        return item.deletable === false
          ? undefined
          : [
              {
                label: 'Delete skill',
                onSelect: () => onDeleteSkill?.(item),
                destructive: true,
              },
            ];
      case 'mcp-server':
        return [
          {
            label: 'Delete server',
            onSelect: () => onDeleteMcpServer?.(item),
            destructive: true,
          },
        ];
    }
  };

  const renderCard = (item: LibraryItem) => {
    const b = byName.get(item.backendId);
    return (
      <ItemCard
        key={`${item.backendId}:${item.kind}:${item.id}`}
        item={item}
        backendName={b?.name ?? item.backendId}
        backendOnline={b?.online ?? false}
        showBackendBadge={!showGroups}
        onOpen={() => onOpen(item)}
        actions={actionsFor(item)}
      />
    );
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-medium">{TAB_TITLE[tab]}</h1>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/30 px-3 py-1.5 text-xs text-muted-foreground focus-within:ring-1 focus-within:ring-ring">
              <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search…"
                aria-label="Search"
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
      ) : groups ? (
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {groups.map(group => (
            <section key={group.backend.backendId}>
              <div className="mb-2 flex items-center gap-2 px-0.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    group.backend.online ? 'bg-emerald-500' : 'bg-muted-foreground/50'
                  }`}
                />
                <h3 className="text-xs font-medium text-muted-foreground">{group.backend.name}</h3>
                <span className="text-[11px] text-muted-foreground/60">{group.items.length}</span>
              </div>
              <div className={gridClass}>{group.items.map(renderCard)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className={`flex-1 overflow-y-auto p-4 ${gridClass}`}>{visible.map(renderCard)}</div>
      )}
    </div>
  );
}
