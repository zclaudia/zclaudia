/**
 * Activity catalog — read-only list of the registered activity building-blocks
 * (server-side ActivityRegistry) that workflows and automations are composed from.
 *
 * Sources the unified /api/workflow-step-types catalog and keeps only the entries
 * tagged `source: 'activity'`, grouped by category. Scoped to the selected backend
 * via the shared automation api, like the other tabs. No create/edit/delete.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Repeat } from 'lucide-react';
import type { WorkflowStepTypeMeta } from '@zclaudia/shared';
import type { AutomationApiType } from './useAutomationApi';
import { LoadingState, EmptyState } from './AutomationSharedComponents';

interface ActivityTabProps {
  api: AutomationApiType;
}

export function ActivityTab({ api }: ActivityTabProps) {
  const [activities, setActivities] = useState<WorkflowStepTypeMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    await api
      .get('/api/workflow-step-types')
      .then((all: WorkflowStepTypeMeta[]) =>
        setActivities((all ?? []).filter((m) => m.source === 'activity')),
      )
      .catch(() => setActivities([]));
    setLoading(false);
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const grouped = useMemo(() => {
    const byCategory = new Map<string, WorkflowStepTypeMeta[]>();
    for (const a of activities) {
      const key = a.category || 'Other';
      const list = byCategory.get(key) ?? [];
      list.push(a);
      byCategory.set(key, list);
    }
    return [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [activities]);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          {activities.length} activit{activities.length !== 1 ? 'ies' : 'y'}
        </h2>
        <button
          onClick={refresh}
          className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {activities.length === 0 ? (
        <EmptyState
          message="No activities registered"
          subtitle="Activities are the building blocks workflows are composed from."
        />
      ) : (
        grouped.map(([category, items]) => (
          <div key={category} className="space-y-1.5">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70 px-0.5">
              {category}
            </h3>
            <div className="space-y-1.5">
              {items.map((a) => (
                <ActivityCard key={a.type} activity={a} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function ActivityCard({ activity }: { activity: WorkflowStepTypeMeta }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{activity.name}</span>
        <code className="text-[11px] font-mono text-muted-foreground/70 bg-muted/50 rounded px-1 py-0.5">
          {activity.type}
        </code>
        {activity.supportsLoop && (
          <span
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground"
            title="Supports loop steps"
          >
            <Repeat size={11} /> loops
          </span>
        )}
      </div>
      {activity.description && (
        <p className="text-xs text-muted-foreground mt-1">{activity.description}</p>
      )}
    </div>
  );
}
