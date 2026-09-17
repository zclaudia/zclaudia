/**
 * Activity catalog — read-only list of the registered activity building-blocks
 * (server-side ActivityRegistry) that workflows and automations are composed from.
 *
 * Sources the unified /api/workflow-step-types catalog of every scoped backend
 * and keeps only the entries tagged `source: 'activity'`, grouped by category
 * (and by backend under "All"). No create/edit/delete.
 */
import { RefreshCw, Repeat, Sparkles, GitBranch, Blocks, type LucideIcon } from 'lucide-react';
import type { WorkflowStepTypeMeta } from '@zclaudia/shared';
import { IconButton } from '../../components/ui/Button';
import { Tooltip } from '../../components/ui/Tooltip';
import {
  LoadingState,
  EmptyState,
  TabToolbar,
  SectionGroup,
  ListCard,
  categoryLabel,
} from './AutomationSharedComponents';
import { AutomationScopeChips, BackendGroups } from './AutomationScope';
import { useAutomationByBackend } from './useAutomationByBackend';
import type { AutomationTabScope } from './AutomationContent';

/** Monochrome lead glyph per category; activities carry no status, so the lead
 *  slot names the family instead of leaving the title unaligned with other tabs. */
const CATEGORY_ICON: Record<string, LucideIcon> = {
  ai: Sparkles,
  git: GitBranch,
};

function byCategory(items: WorkflowStepTypeMeta[]): [string, WorkflowStepTypeMeta[]][] {
  const map = new Map<string, WorkflowStepTypeMeta[]>();
  for (const a of items) {
    const key = a.category || 'Other';
    const list = map.get(key) ?? [];
    list.push(a);
    map.set(key, list);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function ActivityTab({ scope }: { scope: AutomationTabScope }) {
  const catalog = useAutomationByBackend<WorkflowStepTypeMeta[]>(scope.backends, api =>
    api
      .get('/api/workflow-step-types')
      .then((all: WorkflowStepTypeMeta[]) => (all ?? []).filter(m => m.source === 'activity'))
  );
  const total = [...catalog.data.values()].reduce((n, list) => n + list.length, 0);

  return (
    <div className="space-y-4">
      <TabToolbar
        unknown={catalog.data.size === 0 && catalog.errors.size > 0}
        count={total}
        noun={{ one: 'activity', other: 'activities' }}
      >
        <Tooltip content="Refresh">
          <IconButton onClick={catalog.refresh} aria-label="Refresh">
            <RefreshCw size={14} className={catalog.loading ? 'animate-spin' : ''} />
          </IconButton>
        </Tooltip>
      </TabToolbar>
      <AutomationScopeChips backends={scope.allBackends} />

      {catalog.loading && catalog.data.size === 0 ? (
        <LoadingState />
      ) : (
        <BackendGroups
          backends={scope.backends}
          catalog={catalog}
          grouped={scope.grouped}
          count={items => items.length}
          empty={
            <EmptyState
              icon={Blocks}
              message="No activities registered"
              subtitle="Activities are the building blocks workflows are composed from."
            />
          }
          render={items => (
            <div className="space-y-4">
              {byCategory(items).map(([category, list]) => (
                <SectionGroup key={category} label={categoryLabel(category)}>
                  {list.map(a => (
                    <ActivityRow key={a.type} activity={a} />
                  ))}
                </SectionGroup>
              ))}
            </div>
          )}
        />
      )}
    </div>
  );
}

function ActivityRow({ activity }: { activity: WorkflowStepTypeMeta }) {
  const Icon = CATEGORY_ICON[(activity.category ?? '').toLowerCase()] ?? Blocks;
  return (
    <ListCard
      lead={<Icon size={15} strokeWidth={1.75} />}
      title={activity.name}
      titleExtra={
        <code className="shrink-0 rounded-[var(--radius-inline-token)] bg-muted/60 px-1 py-0.5 font-mono text-2xs text-muted-foreground max-md:hidden">
          {activity.type}
        </code>
      }
      meta={activity.description ? <span>{activity.description}</span> : undefined}
      trail={
        activity.supportsLoop ? (
          <Tooltip content="Can run inside loop steps">
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Repeat size={12} strokeWidth={1.75} />
              <span className="max-md:hidden">Supports loops</span>
            </span>
          </Tooltip>
        ) : undefined
      }
    />
  );
}
