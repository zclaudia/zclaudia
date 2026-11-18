import { useMemo, useState } from 'react';
import { FolderInput, Plus, Search } from 'lucide-react';
import type { AgentsBackend, AgentsTab, LibraryItem } from './agents-types';
import { ItemCard } from './ui/ItemCard';
import type { ItemCardAction } from './ui/ItemCard';
import { FilterChips } from './ui/FilterChips';
import { Button } from '../../components/ui/Button';
import { PaneSkeleton } from '../../components/ui/Skeleton';
import { STATUS_TONE, TONE_DOT } from '../../components/ui/tone';

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
  onImportSkills,
  onSetProfileDefault,
  onDeleteProfile,
  onSetLlmProfileDefault,
  onDeleteLlmProfile,
  onDeleteSkill,
  onDeleteMcpServer,
  loading = false,
  errors,
  onRetry,
}: {
  tab: AgentsTab;
  backendFilter: string;
  backends: AgentsBackend[];
  items: LibraryItem[];
  onOpen: (item: LibraryItem) => void;
  onSelectBackendFilter: (key: string) => void;
  onNew: () => void;
  /** Skills tab only: open the external-agent skills import dialog. */
  onImportSkills?: () => void;
  onSetProfileDefault?: (item: LibraryItem) => void;
  onDeleteProfile?: (item: LibraryItem) => void;
  onSetLlmProfileDefault?: (item: LibraryItem) => void;
  onDeleteLlmProfile?: (item: LibraryItem) => void;
  onDeleteSkill?: (item: LibraryItem) => void;
  onDeleteMcpServer?: (item: LibraryItem) => void;
  loading?: boolean;
  errors?: ReadonlyMap<string, string>;
  onRetry?: () => void;
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

  const scopedBackends = backends.filter(
    b => backendFilter === 'all' || b.backendId === backendFilter
  );
  const online = scopedBackends.some(b => b.online);
  const failedBackends = scopedBackends.filter(b => errors?.has(b.backendId));
  const hasQuery = query.trim().length > 0;
  const gridClass = 'grid auto-rows-min grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3';

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
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 text-xl font-semibold tracking-tight">{TAB_TITLE[tab]}</h1>
          <div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto">
            <div className="flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring md:h-9">
              <Search className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search…"
                aria-label="Search"
                className="w-full min-w-0 bg-transparent text-foreground outline-none placeholder:text-muted-foreground sm:w-36"
              />
            </div>
            {tab === 'skills' && onImportSkills && (
              <Button onClick={onImportSkills} disabled={!online} className="h-9 shrink-0">
                <FolderInput className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Import
              </Button>
            )}
            <Button variant="primary" onClick={onNew} disabled={!online} className="h-9 shrink-0">
              <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden /> New
            </Button>
          </div>
        </div>
        {(backends.length > 1 || backendFilter !== 'all') && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Backend</span>
            <FilterChips chips={chips} activeKey={backendFilter} onSelect={onSelectBackendFilter} />
          </div>
        )}
      </div>

      {failedBackends.length > 0 && items.length > 0 && (
        <div
          role="status"
          className="mx-4 mt-4 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
        >
          <p className="flex-1">
            部分 Backend 加载失败：{failedBackends.map(b => b.name).join('、')}
          </p>
          {onRetry && (
            <Button onClick={onRetry} disabled={loading}>
              重试
            </Button>
          )}
        </div>
      )}
      {loading && items.length === 0 ? (
        <div role="status" aria-busy="true" className="flex-1">
          <span className="sr-only">正在加载资源</span>
          <PaneSkeleton />
        </div>
      ) : visible.length === 0 ? (
        <div
          role="status"
          className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center"
        >
          <p className="text-sm font-medium text-foreground">
            {!online
              ? 'Backend 暂不可用'
              : failedBackends.length > 0
                ? '资源加载失败'
                : hasQuery
                  ? '没有匹配的资源'
                  : '还没有资源'}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {!online
              ? '请检查 Backend 连接，恢复后会自动更新。'
              : failedBackends.length > 0
                ? '数据暂时无法读取，请重试；已有资源不会因此被删除。'
                : hasQuery
                  ? '试试其他关键词，或清空搜索查看全部资源。'
                  : '点击右上角 New，创建第一个资源。'}
          </p>
          {online && failedBackends.length > 0 && onRetry ? (
            <Button variant="outline" onClick={onRetry} className="mt-2">
              重新加载
            </Button>
          ) : hasQuery ? (
            <Button variant="outline" onClick={() => setQuery('')} className="mt-2">
              清空搜索
            </Button>
          ) : null}
        </div>
      ) : groups ? (
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {groups.map(group => (
            <section key={group.backend.backendId}>
              <div className="mb-2 flex items-center gap-2 px-0.5">
                <span
                  role="img"
                  aria-label={group.backend.online ? '在线' : '离线'}
                  className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[group.backend.online ? STATUS_TONE.online : STATUS_TONE.offline]}`}
                />
                <h2 className="text-sm font-medium text-muted-foreground">{group.backend.name}</h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {group.items.length}
                </span>
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
