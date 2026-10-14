import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Loader2 } from 'lucide-react';
import type { Workflow, WorkflowStepTypeMeta } from '@zclaudia/shared/features/workflows';
import type { AutomationBackend } from './automation-types';
import { createAutomationApi } from './useAutomationApi';
import type { ByBackend } from './useAutomationByBackend';
import { projectLabel, type ProjectInfoLite } from './AutomationScope';
import { SchemaForm, missingRequiredKeys } from './SchemaForm';

export function CreateAutomationForm({
  backends,
  projects,
  projectId,
  onCancel,
  onCreated,
}: {
  backends: AutomationBackend[];
  projects: ByBackend<ProjectInfoLite[]>;
  projectId?: string;
  onCancel: () => void;
  onCreated: () => void;
}) {
  // Under "All" the automation is created on the first (local) backend unless
  // the picker says otherwise — the same default the Agents shell uses.
  const [targetBackendId, setTargetBackendId] = useState(backends[0].backendId);
  useEffect(() => {
    if (!backends.some(b => b.backendId === targetBackendId)) {
      setTargetBackendId(backends[0].backendId);
    }
  }, [backends, targetBackendId]);
  const api = useMemo(() => createAutomationApi(targetBackendId), [targetBackendId]);

  const [newName, setNewName] = useState('');
  const [newTriggerType, setNewTriggerType] = useState<string>('interval');
  const [newIntervalMinutes, setNewIntervalMinutes] = useState('60');
  const [newCron, setNewCron] = useState('');
  const [newOnceAt, setNewOnceAt] = useState('');
  const [newEvent, setNewEvent] = useState('');
  const [newActionType, setNewActionType] = useState('ai_prompt');
  const [workflowRef, setWorkflowRef] = useState('');
  const [availableWorkflows, setAvailableWorkflows] = useState<Workflow[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [stepTypes, setStepTypes] = useState<WorkflowStepTypeMeta[]>([]);
  const [actionConfig, setActionConfig] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  /** The action/workflow catalogs failed to load; an empty picker must say
   *  why instead of reading as "nothing to pick". Retried independently of
   *  the list above. */
  const [catalogError, setCatalogError] = useState<string | null>(null);
  /** Bumped by the catalog Retry button. */
  const [catalogNonce, setCatalogNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      api.get('/api/workflow-step-types'),
      // All workflows (unfiltered): bindable workflows are global/system
      // workflows (e.g. the seeded Auto-Commit), which /api/workflows?projectId=X
      // would exclude.
      api.get('/api/workflows'),
    ]).then(([stepTypesRes, workflowsRes]) => {
      if (cancelled) return;
      if (stepTypesRes.status === 'fulfilled') {
        const res = stepTypesRes.value as
          | { success?: boolean; data?: WorkflowStepTypeMeta[] }
          | WorkflowStepTypeMeta[];
        setStepTypes(Array.isArray(res) ? res : (res.data ?? []));
      } else {
        setStepTypes([]);
      }
      if (workflowsRes.status === 'fulfilled') {
        setAvailableWorkflows((workflowsRes.value as Workflow[]) ?? []);
      } else {
        setAvailableWorkflows([]);
      }
      const failed =
        stepTypesRes.status === 'rejected' && workflowsRes.status === 'rejected'
          ? 'action types and workflows'
          : stepTypesRes.status === 'rejected'
            ? 'action types'
            : workflowsRes.status === 'rejected'
              ? 'workflows'
              : null;
      setCatalogError(failed ? `Couldn't load the ${failed} catalog.` : null);
    });
    return () => {
      cancelled = true;
    };
  }, [api, catalogNonce]);

  const inlineActionOptions = useMemo(
    () =>
      stepTypes
        .filter(m => m.category !== 'Flow Control' && m.category !== 'Permission')
        .map(m => ({ value: m.type, label: m.name })),
    [stepTypes]
  );
  const selectedStepType = useMemo(
    () => stepTypes.find(m => m.type === newActionType),
    [stepTypes, newActionType]
  );

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    if (newActionType === 'workflow' && !workflowRef) return;
    if (submitting) return;

    let action:
      | { kind: 'workflow'; ref: string }
      | { kind: 'activity'; ref: string; input: Record<string, unknown> };
    if (newActionType === 'workflow') {
      action = { kind: 'workflow', ref: workflowRef };
    } else {
      // An action picked while its catalog was down would be posted as an
      // unknown ref; block it instead of shipping something that can never run.
      if (catalogError) {
        setCreateError("The action catalog didn't load — retry it, then pick the action again.");
        return;
      }
      if (stepTypes.length > 0 && !selectedStepType) {
        setCreateError(`Unknown action type: ${newActionType}`);
        return;
      }
      const missing = missingRequiredKeys(selectedStepType?.configSchema, actionConfig);
      if (missing.length) {
        setCreateError(`Missing required: ${missing.join(', ')}`);
        return;
      }
      action = { kind: 'activity', ref: newActionType, input: actionConfig };
    }

    const trigger: Record<string, unknown> = { type: newTriggerType };
    if (newTriggerType === 'interval') {
      const raw = newIntervalMinutes.trim();
      if (raw !== '' && (!/^\d+$/.test(raw) || parseInt(raw, 10) <= 0)) {
        setCreateError('Interval must be a positive whole number of minutes');
        return;
      }
      trigger.intervalMinutes = raw === '' ? 60 : parseInt(raw, 10);
    }
    if (newTriggerType === 'cron') trigger.cron = newCron;
    if (newTriggerType === 'once') {
      const onceAt = newOnceAt ? new Date(newOnceAt).getTime() : NaN;
      if (!Number.isFinite(onceAt)) {
        setCreateError('Please choose a valid run time');
        return;
      }
      trigger.onceAt = onceAt;
    }
    if (newTriggerType === 'event') trigger.event = newEvent;

    try {
      setSubmitting(true);
      setCreateError(null);
      await api.post('/api/automations', {
        name: newName.trim(),
        projectId: projectId || undefined,
        trigger,
        action,
      });
      onCreated();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create automation');
    } finally {
      setSubmitting(false);
    }
  }, [
    api,
    actionConfig,
    catalogError,
    newActionType,
    newCron,
    newEvent,
    newIntervalMinutes,
    newName,
    newOnceAt,
    newTriggerType,
    onCreated,
    projectId,
    selectedStepType,
    stepTypes.length,
    submitting,
    workflowRef,
  ]);

  const targetBackend = backends.find(b => b.backendId === targetBackendId);

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      {/* The submit scope stays visible so a draft's destination is never a
          surprise (the project chips above own the scope, not this form). */}
      <div className="text-2xs text-muted-foreground">
        Saving to {targetBackend?.name ?? targetBackendId} ·{' '}
        {projectLabel(projects, targetBackendId, projectId)}
      </div>
      {backends.length > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">Backend</span>
          <Select
            value={targetBackendId}
            onChange={setTargetBackendId}
            size="md"
            triggerClassName="min-w-[140px]"
            options={backends.map(b => ({ value: b.backendId, label: b.name }))}
          />
        </div>
      )}
      <Input
        value={newName}
        onChange={e => setNewName(e.target.value)}
        placeholder="Automation name"
        aria-label="Automation name"
      />
      <div className="flex gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Trigger</span>
          <Select
            value={newTriggerType}
            onChange={setNewTriggerType}
            size="md"
            triggerClassName="min-w-[100px]"
            options={[
              { value: 'manual', label: 'Manual' },
              { value: 'interval', label: 'Interval' },
              { value: 'cron', label: 'Cron' },
              { value: 'once', label: 'Once' },
              { value: 'event', label: 'Event' },
            ]}
          />
        </div>
        {newTriggerType === 'interval' && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">every</span>
            <Input
              value={newIntervalMinutes}
              onChange={e => setNewIntervalMinutes(e.target.value)}
              placeholder="60"
              aria-label="Interval in minutes"
              className="w-16"
            />
            <span className="text-xs text-muted-foreground">min</span>
          </div>
        )}
        {newTriggerType === 'cron' && (
          <Input
            value={newCron}
            onChange={e => setNewCron(e.target.value)}
            placeholder="0 9 * * *"
            aria-label="Cron expression"
            className="flex-1 font-mono"
          />
        )}
        {newTriggerType === 'once' && (
          <Input
            type="datetime-local"
            value={newOnceAt}
            onChange={e => setNewOnceAt(e.target.value)}
            aria-label="Run at"
            className="w-auto"
          />
        )}
        {newTriggerType === 'event' && (
          <Input
            value={newEvent}
            onChange={e => setNewEvent(e.target.value)}
            placeholder="plugin.event.name"
            aria-label="Event name"
            className="flex-1"
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-xs text-muted-foreground">Action</span>
        <Select
          value={newActionType}
          onChange={v => {
            setNewActionType(v);
            setActionConfig({});
          }}
          size="md"
          triggerClassName="min-w-[140px]"
          options={[...inlineActionOptions, { value: 'workflow', label: 'Workflow' }]}
        />
      </div>
      {newActionType === 'workflow' ? (
        <Select
          value={workflowRef}
          onChange={setWorkflowRef}
          size="md"
          block
          placeholder="Select workflow…"
          options={availableWorkflows.map(w => ({ value: w.id, label: w.name }))}
        />
      ) : (
        <SchemaForm
          schema={selectedStepType?.configSchema}
          value={actionConfig}
          onChange={setActionConfig}
        />
      )}
      {catalogError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
        >
          <span>{catalogError}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCatalogNonce(n => n + 1)}
            className="shrink-0"
          >
            Retry
          </Button>
        </div>
      )}
      {createError && <div className="text-xs text-destructive">{createError}</div>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} className="max-md:flex-1">
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleCreate}
          disabled={submitting || !newName.trim() || (newActionType === 'workflow' && !workflowRef)}
          className="max-md:flex-1"
        >
          {submitting && <Loader2 size={13} className="animate-spin" />}
          {submitting ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </div>
  );
}
