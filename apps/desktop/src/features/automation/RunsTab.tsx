import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, ArrowLeft, ChevronRight, History } from 'lucide-react';
import type { Workflow, WorkflowDefinition, WorkflowRun, WorkflowStepRun } from '@zclaudia/shared';
import { normalizeWorkflowDefinition } from '@zclaudia/shared';
import {
  RunStatusBadge,
  formatDuration,
  runStatusTone,
} from '../workflows/components/RunComponents';
import { RunStepList } from '../workflows/components/RunStepList';
import { Button, IconButton } from '../../components/ui/Button';
import { Tooltip } from '../../components/ui/Tooltip';
import { createAutomationApi, type AutomationApiType } from './useAutomationApi';
import { useAutomationByBackend } from './useAutomationByBackend';
import type { AutomationBackend } from './automation-types';
import {
  LoadingState,
  EmptyState,
  TabToolbar,
  SectionGroup,
  ListCard,
  StatusDot,
  MetaSep,
} from './AutomationSharedComponents';
import { AutomationScopeChips, BackendGroups, ScopeChunk, projectLabel } from './AutomationScope';
import type { AutomationTabScope } from './AutomationContent';

/**
 * What to call a run in a list. Prefers the workflow's name, then the action it
 * ran, and only then a shortened id — a bare UUID is indistinguishable from
 * every other run at phone width.
 */
function runLabel(run: WorkflowRun, names: Map<string, string>): string {
  if (run.workflowId) {
    const name = names.get(run.workflowId);
    if (name) return name;
  }
  if (run.actionRef && !run.workflowId) return run.actionRef;
  return run.workflowId ? `Workflow ${run.workflowId.slice(0, 8)}` : 'Activity';
}

/** Group label for a run's start time: Today / Yesterday / a short date. */
function dayLabel(ts: number, now = new Date()): string {
  const d = new Date(ts);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function stampLabel(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface RunsCatalog {
  runs: WorkflowRun[];
  names: Map<string, string>;
}

export function RunsTab({ scope }: { scope: AutomationTabScope }) {
  const [selected, setSelected] = useState<{ backendId: string; runId: string } | null>(null);
  const projectQuery = scope.projectId ? `?projectId=${encodeURIComponent(scope.projectId)}` : '';

  const catalog = useAutomationByBackend<RunsCatalog>(scope.backends, async api => {
    // Runs are project-scoped, but the workflows they reference often are not
    // (the built-in ones carry no projectId), so names come from the unscoped
    // list plus the scoped one.
    const [runs, scopedWorkflows, globalWorkflows] = await Promise.all([
      api.get(`/api/workflow-runs${projectQuery}`).then((r: WorkflowRun[]) => r ?? []),
      projectQuery
        ? api.get(`/api/workflows${projectQuery}`).catch(() => [] as Workflow[])
        : Promise.resolve([] as Workflow[]),
      api.get('/api/workflows').catch(() => [] as Workflow[]),
    ]);
    const names = new Map<string, string>();
    for (const w of [...globalWorkflows, ...scopedWorkflows] as Workflow[]) names.set(w.id, w.name);
    const sorted = [...runs].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    return { runs: sorted, names };
  });
  const total = [...catalog.data.values()].reduce((n, c) => n + c.runs.length, 0);

  if (selected) {
    const entry = catalog.data.get(selected.backendId);
    const run = entry?.runs.find(r => r.id === selected.runId);
    return (
      <RunDetail
        api={createAutomationApi(selected.backendId)}
        runId={selected.runId}
        workflowName={run && entry ? runLabel(run, entry.names) : ''}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <TabToolbar
        count={total}
        noun="run"
        unknown={catalog.data.size === 0 && catalog.errors.size > 0}
      >
        <Tooltip content="Refresh">
          <IconButton aria-label="Refresh" onClick={catalog.refresh} disabled={catalog.loading}>
            <RefreshCw size={14} className={catalog.loading ? 'animate-spin' : ''} />
          </IconButton>
        </Tooltip>
      </TabToolbar>
      <AutomationScopeChips backends={scope.allBackends} withProjects />

      {catalog.loading && catalog.data.size === 0 ? (
        <LoadingState />
      ) : (
        <BackendGroups
          backends={scope.backends}
          catalog={catalog}
          grouped={scope.grouped}
          count={c => c.runs.length}
          empty={
            <EmptyState
              icon={History}
              message="No workflow runs yet"
              subtitle="Runs appear here once an automation or workflow is triggered."
            />
          }
          render={(c, backend) => (
            <RunList
              runs={c.runs}
              names={c.names}
              backend={backend}
              scope={scope}
              byDay={!scope.grouped}
              onOpen={runId => setSelected({ backendId: backend.backendId, runId })}
            />
          )}
        />
      )}
    </div>
  );
}

function RunList({
  runs,
  names,
  backend,
  scope,
  byDay,
  onOpen,
}: {
  runs: WorkflowRun[];
  names: Map<string, string>;
  backend: AutomationBackend;
  scope: AutomationTabScope;
  /** Day sections read well for one backend; under backend headers a full stamp does. */
  byDay: boolean;
  onOpen: (runId: string) => void;
}) {
  const row = (run: WorkflowRun) => (
    <ListCard
      key={run.id}
      onClick={() => onOpen(run.id)}
      lead={<StatusDot tone={runStatusTone(run.status)} pulse={run.status === 'running'} />}
      title={runLabel(run, names)}
      titleExtra={<RunStatusBadge status={run.status} />}
      meta={
        <>
          <ScopeChunk
            projectId={run.projectId}
            label={projectLabel(scope.projects, backend.backendId, run.projectId)}
          />
          <MetaSep />
          <span>{run.triggerSource}</span>
          <MetaSep />
          <span className="tabular-nums">{formatDuration(run.startedAt, run.completedAt)}</span>
          {run.startedAt && (
            <>
              <MetaSep />
              <span className="tabular-nums md:hidden">
                {byDay ? timeLabel(run.startedAt) : stampLabel(run.startedAt)}
              </span>
            </>
          )}
          {run.error && (
            <>
              <MetaSep />
              <span className="min-w-0 truncate text-destructive max-md:whitespace-normal">
                {run.error}
              </span>
            </>
          )}
        </>
      }
      trail={
        <>
          {run.startedAt && (
            <span className="text-xs tabular-nums text-muted-foreground max-md:hidden">
              {byDay ? timeLabel(run.startedAt) : stampLabel(run.startedAt)}
            </span>
          )}
          <ChevronRight size={14} strokeWidth={1.75} className="text-muted-foreground" />
        </>
      }
    />
  );

  if (!byDay) return <div className="space-y-1.5">{runs.map(row)}</div>;

  const days = new Map<string, WorkflowRun[]>();
  for (const run of runs) {
    const key = run.startedAt ? dayLabel(run.startedAt) : 'Not started';
    const list = days.get(key) ?? [];
    list.push(run);
    days.set(key, list);
  }
  return (
    <div className="space-y-4">
      {[...days.entries()].map(([day, list]) => (
        <SectionGroup key={day} label={day}>
          {list.map(row)}
        </SectionGroup>
      ))}
    </div>
  );
}

function RunDetail({
  api,
  runId,
  workflowName,
  onBack,
}: {
  api: AutomationApiType;
  runId: string;
  workflowName: string;
  onBack: () => void;
}) {
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [stepRuns, setStepRuns] = useState<WorkflowStepRun[]>([]);
  const [definition, setDefinition] = useState<WorkflowDefinition | undefined>();
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyStepRunId, setBusyStepRunId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data: { run: WorkflowRun; stepRuns: WorkflowStepRun[] } = await api.get(
      `/api/workflow-runs/${runId}`
    );
    setRun(data.run);
    setStepRuns(data.stepRuns);
    // Names only — the run's own records set the order, since the workflow may
    // have been edited since it ran.
    if (data.run.workflowId) {
      try {
        const wf: Workflow = await api.get(`/api/workflows/${data.run.workflowId}`);
        setDefinition(normalizeWorkflowDefinition(wf.definition));
      } catch {
        setDefinition(undefined);
      }
    }
  }, [api, runId]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [load]);

  /** Approve/reject/cancel used to swallow their errors and never refresh, so a
   *  failed tap looked identical to a successful one. */
  const runAction = async (label: string, path: string, stepRunId?: string) => {
    setActionError(null);
    if (stepRunId) setBusyStepRunId(stepRunId);
    try {
      await api.post(path);
      await load();
    } catch (err) {
      setActionError(`${label} failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusyStepRunId(null);
    }
  };

  const stamp = useMemo(() => (run ? new Date(run.startedAt).toLocaleString() : ''), [run]);

  if (loading || !run) {
    return (
      <div className="space-y-4">
        <Button onClick={onBack} className="-ml-2">
          <ArrowLeft size={16} /> Back
        </Button>
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <IconButton onClick={onBack} aria-label="Back to runs">
            <ArrowLeft size={16} />
          </IconButton>
          <div>
            <div className="text-sm font-medium">{workflowName}</div>
            <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
              <RunStatusBadge status={run.status} />
              <span>
                {run.triggerSource}
                {run.triggerDetail ? ` · ${run.triggerDetail}` : ''}
              </span>
              <span>{formatDuration(run.startedAt, run.completedAt)}</span>
              <span>{stamp}</span>
            </div>
          </div>
        </div>
        {(run.status === 'running' || run.status === 'pending') && (
          <Button
            variant="destructive"
            onClick={() => void runAction('Cancel', `/api/workflow-runs/${runId}/cancel`)}
            className="shrink-0"
          >
            Cancel
          </Button>
        )}
      </div>

      {actionError && <p className="text-xs text-destructive">{actionError}</p>}

      {/* Steps — the same card the workflow view uses, with the run overlaid. */}
      <RunStepList
        stepRuns={stepRuns}
        definition={definition}
        busyStepRunId={busyStepRunId}
        onApprove={id => void runAction('Approve', `/api/workflow-step-runs/${id}/approve`, id)}
        onReject={id => void runAction('Reject', `/api/workflow-step-runs/${id}/reject`, id)}
      />

      {run.error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded-md p-3">{run.error}</div>
      )}
    </div>
  );
}
