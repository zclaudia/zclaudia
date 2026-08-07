import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, RefreshCw, ArrowLeft } from 'lucide-react';
import type { Workflow, WorkflowDefinition, WorkflowRun, WorkflowStepRun } from '@zclaudia/shared';
import { normalizeWorkflowDefinition } from '@zclaudia/shared';
import { RunStatusBadge, formatDuration } from '../workflows/components/RunComponents';
import { RunStepList } from '../workflows/components/RunStepList';
import { IconButton } from '../../components/ui/Button';
import type { AutomationApiType } from './useAutomationApi';

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

interface RunsTabProps {
  api: AutomationApiType;
  projectId?: string;
}

export function RunsTab({ api, projectId }: RunsTabProps) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const effectiveProjectId = projectId ?? '';

  const workflowNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of workflows) map.set(w.id, w.name);
    return map;
  }, [workflows]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const query = effectiveProjectId
        ? `?projectId=${encodeURIComponent(effectiveProjectId)}`
        : '';
      // Runs are project-scoped, but the workflows they reference often are not
      // (the built-in ones carry no projectId). Scoping the name lookup the same
      // way returned an empty list, so every row fell back to a raw UUID slice.
      const [runsData, scopedWorkflows, globalWorkflows] = await Promise.all([
        api.get(`/api/workflow-runs${query}`).catch(() => []),
        query ? api.get(`/api/workflows${query}`).catch(() => []) : Promise.resolve([]),
        api.get('/api/workflows').catch(() => []),
      ]);
      setRuns(runsData);
      const byId = new Map<string, Workflow>();
      for (const w of [...globalWorkflows, ...scopedWorkflows]) byId.set(w.id, w);
      setWorkflows([...byId.values()]);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [api, effectiveProjectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (selectedRunId) {
    return (
      <RunDetail
        api={api}
        runId={selectedRunId}
        workflowName={(() => {
          const run = runs.find(r => r.id === selectedRunId);
          if (!run) return '';
          return runLabel(run, workflowNameMap);
        })()}
        onBack={() => setSelectedRunId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Run History</h2>
        <div className="flex items-center gap-2">
          <IconButton aria-label="Refresh" onClick={refresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </IconButton>
        </div>
      </div>

      {loading && runs.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">No workflow runs yet.</div>
      ) : (
        <div className="space-y-2">
          {runs.map(run => (
            <button
              key={run.id}
              onClick={() => setSelectedRunId(run.id)}
              className="w-full text-left border border-border rounded-lg p-3 hover:bg-secondary/30 transition-colors"
            >
              <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <RunStatusBadge status={run.status} />
                  <span className="text-sm font-medium truncate">
                    {runLabel(run, workflowNameMap)}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground md:shrink-0">
                  <span className="px-1.5 py-0.5 rounded-md bg-muted">{run.triggerSource}</span>
                  <span>{formatDuration(run.startedAt, run.completedAt)}</span>
                  <span className="truncate">
                    {new Date(run.startedAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
              {run.error && (
                <div className="mt-1 text-xs text-destructive truncate">{run.error}</div>
              )}
            </button>
          ))}
        </div>
      )}
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

  if (loading || !run) {
    return (
      <div className="space-y-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <div className="text-sm font-medium">{workflowName}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <RunStatusBadge status={run.status} />
              <span>
                {run.triggerSource}
                {run.triggerDetail ? ` · ${run.triggerDetail}` : ''}
              </span>
              <span>{formatDuration(run.startedAt, run.completedAt)}</span>
              <span>{new Date(run.startedAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
        {(run.status === 'running' || run.status === 'pending') && (
          <button
            onClick={() => void runAction('Cancel', `/api/workflow-runs/${runId}/cancel`)}
            className="shrink-0 rounded-md border border-border px-3 py-1 text-xs transition-colors hover:bg-destructive hover:text-destructive-foreground max-md:py-2"
          >
            Cancel
          </button>
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
