import { Loader2, RefreshCw, Server } from 'lucide-react';
import type { SystemTaskInfo } from '@zclaudia/shared';
import { formatInterval } from './automation-types';
import { IconButton } from '../../components/ui/Button';
import { Tooltip } from '../../components/ui/Tooltip';
import {
  LoadingState,
  EmptyState,
  TabToolbar,
  SectionGroup,
  ListCard,
  StatusDot,
  ToneBadge,
  MetaSep,
  categoryLabel,
} from './AutomationSharedComponents';
import { AutomationScopeChips, BackendGroups } from './AutomationScope';
import { useAutomationByBackend } from './useAutomationByBackend';
import type { AutomationTabScope } from './AutomationContent';

// The category used to be a colored chip on every row; as a group label it
// carries the same information without a badge per row.
function byCategory(tasks: SystemTaskInfo[]): [string, SystemTaskInfo[]][] {
  const map = new Map<string, SystemTaskInfo[]>();
  for (const t of tasks) {
    const key = t.category || 'other';
    const list = map.get(key) ?? [];
    list.push(t);
    map.set(key, list);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function SystemTasksTab({ scope }: { scope: AutomationTabScope }) {
  const catalog = useAutomationByBackend<SystemTaskInfo[]>(scope.backends, api =>
    api.get('/api/system-tasks').then((list: SystemTaskInfo[]) => list ?? [])
  );
  const total = [...catalog.data.values()].reduce((n, list) => n + list.length, 0);

  return (
    <div className="space-y-4">
      <TabToolbar
        unknown={catalog.data.size === 0 && catalog.errors.size > 0}
        count={total}
        noun="system task"
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
          empty={<EmptyState icon={Server} message="No system tasks running" />}
          render={items => (
            <div className="space-y-4">
              {byCategory(items).map(([category, list]) => (
                <SectionGroup key={category} label={categoryLabel(category)}>
                  {list.map(t => (
                    <SystemTaskRow key={t.id} task={t} />
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

function SystemTaskRow({ task }: { task: SystemTaskInfo }) {
  const running = task.status === 'running';
  const errored = task.status === 'error';
  return (
    <ListCard
      lead={
        running ? (
          <Loader2 size={14} className="animate-spin text-thinking" />
        ) : (
          <StatusDot tone={errored ? 'destructive' : 'success'} />
        )
      }
      title={task.name}
      titleExtra={
        running ? (
          <ToneBadge tone="thinking">running</ToneBadge>
        ) : errored ? (
          <ToneBadge tone="destructive">error</ToneBadge>
        ) : undefined
      }
      meta={
        <>
          <span>every {formatInterval(task.intervalMs)}</span>
          <MetaSep />
          <span className="tabular-nums">
            {task.runCount.toLocaleString()} run{task.runCount !== 1 ? 's' : ''}
          </span>
          {task.lastRunDurationMs !== undefined && (
            <>
              <MetaSep />
              <span className="tabular-nums">last {task.lastRunDurationMs}ms</span>
            </>
          )}
          {task.lastError && (
            <>
              <MetaSep />
              <Tooltip content={task.lastError}>
                <span className="max-w-[16rem] truncate text-destructive">{task.lastError}</span>
              </Tooltip>
            </>
          )}
        </>
      }
    />
  );
}
