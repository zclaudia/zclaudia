import { useState } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import { Tooltip } from '../../components/ui/Tooltip';
import { Plus, RefreshCw, Zap, X } from 'lucide-react';
import type { Automation } from '@zclaudia/shared/features/automations';
import type { Workflow } from '@zclaudia/shared/features/workflows';
import type { AutomationItem, AutomationBackend } from './automation-types';
import { automationToItem } from './automation-types';
import { createAutomationApi, type AutomationApiType } from './useAutomationApi';
import { useAutomationByBackend } from './useAutomationByBackend';
import { LoadingState, EmptyState, TabToolbar, SectionGroup } from './AutomationSharedComponents';
import { AutomationScopeChips, BackendGroups, projectLabel } from './AutomationScope';
import { CreateAutomationForm } from './CreateAutomationForm';
import { AutomationCard } from './AutomationCard';
import type { AutomationTabScope } from './AutomationContent';

interface AutomationsCatalog {
  items: AutomationItem[];
}

export function AutomationsTab({ scope }: { scope: AutomationTabScope }) {
  const { projectId } = scope;
  const projectQuery = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';

  const catalog = useAutomationByBackend<AutomationsCatalog>(
    scope.backends,
    async api => {
      // Bindable workflows are global/system ones which a project-scoped list
      // would exclude, so names come from the unscoped list.
      const [automations, workflows] = await Promise.all([
        api.get(`/api/automations${projectQuery}`).then((a: Automation[]) => a ?? []),
        api.get('/api/workflows').catch(() => [] as Workflow[]),
      ]);
      const names = new Map((workflows as Workflow[]).map(w => [w.id, w.name]));
      const items = automations
        .map(a => automationToItem(a, names))
        .sort((a, b) => (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0));
      return { items };
    },
    // The fetcher closes over the project filter; without this dependency a
    // scope switch kept rendering the previous scope's rows until Refresh.
    [projectId]
  );
  const total = [...catalog.data.values()].reduce((n, c) => n + c.items.length, 0);

  const [showCreate, setShowCreate] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** In-flight row actions, keyed `${itemId}:${action}` — the button shows it. */
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());

  /** Run one mutation against the row's backend; a failure must never look
   *  like a successful no-op, so it lands in a banner and the list refetches. */
  const mutate = async (
    key: string,
    backendId: string,
    label: string,
    fn: (api: AutomationApiType) => Promise<unknown>
  ) => {
    setPendingKeys(prev => new Set(prev).add(key));
    try {
      await fn(createAutomationApi(backendId));
      setActionError(null);
    } catch (error) {
      setActionError(`${label}: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      setPendingKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
    catalog.refresh();
  };

  return (
    <div className="space-y-4">
      <TabToolbar
        count={total}
        noun="automation"
        unknown={catalog.data.size === 0 && catalog.errors.size > 0}
      >
        <Button
          variant="primary"
          onClick={() => setShowCreate(!showCreate)}
          aria-expanded={showCreate}
          disabled={scope.backends.length === 0}
        >
          <Plus size={13} />
          New
        </Button>
        <Tooltip content="Refresh">
          <IconButton onClick={catalog.refresh} aria-label="Refresh">
            <RefreshCw size={14} className={catalog.loading ? 'animate-spin' : ''} />
          </IconButton>
        </Tooltip>
      </TabToolbar>
      <AutomationScopeChips backends={scope.allBackends} withProjects />

      {actionError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <span>{actionError}</span>
          <IconButton
            size="sm"
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
            className="shrink-0 text-destructive hover:text-destructive"
          >
            <X size={12} />
          </IconButton>
        </div>
      )}

      {showCreate && scope.backends.length > 0 && (
        // Remounting on project scope change clears the draft with the scope:
        // a draft typed under one project must not silently submit to another.
        <CreateAutomationForm
          key={projectId ?? 'global'}
          backends={scope.backends}
          projects={scope.projects}
          projectId={projectId}
          onCancel={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            catalog.refresh();
          }}
        />
      )}

      {catalog.loading && catalog.data.size === 0 ? (
        <LoadingState />
      ) : (
        <BackendGroups
          backends={scope.backends}
          catalog={catalog}
          grouped={scope.grouped}
          count={c => c.items.length}
          empty={
            showCreate ? null : (
              <EmptyState
                icon={Zap}
                message="No automations yet"
                subtitle="Create one or enable a template to get started"
              />
            )
          }
          render={(c, backend) => (
            <AutomationList
              items={c.items}
              backend={backend}
              scope={scope}
              sections={!scope.grouped}
              pendingKeys={pendingKeys}
              onToggle={item =>
                mutate(
                  `${item.id}:toggle`,
                  backend.backendId,
                  `Failed to ${item.enabled ? 'disable' : 'enable'} "${item.name}"`,
                  api => api.patch(`/api/automations/${item.id}`, { enabled: !item.enabled })
                )
              }
              onTrigger={item =>
                mutate(`${item.id}:run`, backend.backendId, `Failed to run "${item.name}"`, api =>
                  api.post(`/api/automations/${item.id}/trigger`)
                )
              }
              onDelete={item =>
                mutate(
                  `${item.id}:delete`,
                  backend.backendId,
                  `Failed to delete "${item.name}"`,
                  api => api.del(`/api/automations/${item.id}`)
                )
              }
            />
          )}
        />
      )}
    </div>
  );
}

function AutomationList({
  items,
  backend,
  scope,
  sections,
  pendingKeys,
  onToggle,
  onTrigger,
  onDelete,
}: {
  items: AutomationItem[];
  backend: AutomationBackend;
  scope: AutomationTabScope;
  /** Active / Disabled sections for one backend; a flat list under backend headers. */
  sections: boolean;
  /** In-flight row actions, keyed `${itemId}:${action}`. */
  pendingKeys: ReadonlySet<string>;
  onToggle: (item: AutomationItem) => void;
  onTrigger: (item: AutomationItem) => void;
  onDelete: (item: AutomationItem) => void;
}) {
  const row = (item: AutomationItem) => (
    <AutomationCard
      key={item.id}
      item={item}
      scopeLabel={projectLabel(scope.projects, backend.backendId, item.projectId)}
      runPending={pendingKeys.has(`${item.id}:run`)}
      togglePending={pendingKeys.has(`${item.id}:toggle`)}
      deletePending={pendingKeys.has(`${item.id}:delete`)}
      onToggle={() => onToggle(item)}
      onTrigger={() => onTrigger(item)}
      onDelete={() => onDelete(item)}
    />
  );
  if (!sections) return <div className="space-y-1.5">{items.map(row)}</div>;

  const enabled = items.filter(i => i.enabled);
  const disabled = items.filter(i => !i.enabled);
  return (
    <div className="space-y-4">
      {enabled.length > 0 && (
        <SectionGroup label={`Active (${enabled.length})`}>{enabled.map(row)}</SectionGroup>
      )}
      {disabled.length > 0 && (
        <SectionGroup label={`Disabled (${disabled.length})`}>{disabled.map(row)}</SectionGroup>
      )}
    </div>
  );
}
