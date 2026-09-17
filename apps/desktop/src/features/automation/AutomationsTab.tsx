import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, IconButton } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Tooltip } from '../../components/ui/Tooltip';
import { Plus, RefreshCw, Play, Pause, Trash2, Zap, Shield, X } from 'lucide-react';
import type { Automation, Workflow, WorkflowStepTypeMeta } from '@zclaudia/shared';
import type { AutomationItem, AutomationBackend } from './automation-types';
import { automationToItem } from './automation-types';
import { Select } from '../../components/ui/Select';
import { createAutomationApi, type AutomationApiType } from './useAutomationApi';
import { useAutomationByBackend } from './useAutomationByBackend';
import {
  LoadingState,
  EmptyState,
  TabToolbar,
  SectionGroup,
  ListCard,
  StatusDot,
  ToneBadge,
  MetaSep,
} from './AutomationSharedComponents';
import { AutomationScopeChips, BackendGroups, ScopeChunk, projectLabel } from './AutomationScope';
import type { AutomationTabScope } from './AutomationContent';
import type { Tone } from '../../components/ui/tone';
import { SchemaForm, missingRequiredKeys } from './SchemaForm';

interface AutomationsCatalog {
  items: AutomationItem[];
}

export function AutomationsTab({ scope }: { scope: AutomationTabScope }) {
  const { projectId } = scope;
  const projectQuery = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';

  const catalog = useAutomationByBackend<AutomationsCatalog>(scope.backends, async api => {
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
  });
  const total = [...catalog.data.values()].reduce((n, c) => n + c.items.length, 0);

  const [showCreate, setShowCreate] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /** Run one mutation against the row's backend; a failure must never look
   *  like a successful no-op, so it lands in a banner and the list refetches. */
  const mutate = async (
    backendId: string,
    label: string,
    fn: (api: AutomationApiType) => Promise<unknown>
  ) => {
    try {
      await fn(createAutomationApi(backendId));
      setActionError(null);
    } catch (error) {
      setActionError(`${label}: ${error instanceof Error ? error.message : 'unknown error'}`);
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
        <CreateAutomationForm
          backends={scope.backends}
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
              onToggle={item =>
                mutate(
                  backend.backendId,
                  `Failed to ${item.enabled ? 'disable' : 'enable'} "${item.name}"`,
                  api => api.patch(`/api/automations/${item.id}`, { enabled: !item.enabled })
                )
              }
              onTrigger={item =>
                mutate(backend.backendId, `Failed to run "${item.name}"`, api =>
                  api.post(`/api/automations/${item.id}/trigger`)
                )
              }
              onDelete={item =>
                mutate(backend.backendId, `Failed to delete "${item.name}"`, api =>
                  api.del(`/api/automations/${item.id}`)
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
  onToggle,
  onTrigger,
  onDelete,
}: {
  items: AutomationItem[];
  backend: AutomationBackend;
  scope: AutomationTabScope;
  /** Active / Disabled sections for one backend; a flat list under backend headers. */
  sections: boolean;
  onToggle: (item: AutomationItem) => void;
  onTrigger: (item: AutomationItem) => void;
  onDelete: (item: AutomationItem) => void;
}) {
  const row = (item: AutomationItem) => (
    <AutomationCard
      key={item.id}
      item={item}
      scopeLabel={projectLabel(scope.projects, backend.backendId, item.projectId)}
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

// ----- Create form -----

function CreateAutomationForm({
  backends,
  projectId,
  onCancel,
  onCreated,
}: {
  backends: AutomationBackend[];
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

  useEffect(() => {
    // Fetch all workflows (unfiltered) for the picker: bindable workflows are global/system
    // workflows (e.g. the seeded Auto-Commit), which /api/workflows?projectId=X would exclude.
    api
      .get('/api/workflows')
      .then(setAvailableWorkflows)
      .catch(() => setAvailableWorkflows([]));
  }, [api]);

  useEffect(() => {
    api
      .get('/api/workflow-step-types')
      .then(
        (res: { success?: boolean; data?: WorkflowStepTypeMeta[] } | WorkflowStepTypeMeta[]) => {
          const data = Array.isArray(res) ? res : (res.data ?? []);
          setStepTypes(data);
        }
      )
      .catch(() => setStepTypes([]));
  }, [api]);

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

    let action:
      | { kind: 'workflow'; ref: string }
      | { kind: 'activity'; ref: string; input: Record<string, unknown> };
    if (newActionType === 'workflow') {
      action = { kind: 'workflow', ref: workflowRef };
    } else {
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
    }
  }, [
    api,
    actionConfig,
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
    workflowRef,
  ]);

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
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
      {createError && <div className="text-xs text-destructive">{createError}</div>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} className="max-md:flex-1">
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleCreate}
          disabled={!newName.trim() || (newActionType === 'workflow' && !workflowRef)}
          className="max-md:flex-1"
        >
          Create
        </Button>
      </div>
    </div>
  );
}

// ----- Row -----

function AutomationCard({
  item,
  scopeLabel,
  onToggle,
  onTrigger,
  onDelete,
}: {
  item: AutomationItem;
  scopeLabel: string;
  onToggle: () => void;
  onTrigger: () => void;
  onDelete: () => void;
}) {
  const tone: Tone =
    item.status === 'running'
      ? 'warning'
      : item.status === 'error'
        ? 'destructive'
        : item.enabled
          ? 'success'
          : 'neutral';
  return (
    <ListCard
      data-automation-card
      muted={!item.enabled}
      lead={<StatusDot tone={tone} pulse={item.status === 'running'} />}
      title={item.name}
      titleExtra={item.isSystem ? <ToneBadge tone="neutral">System</ToneBadge> : undefined}
      meta={
        <>
          <ScopeChunk projectId={item.projectId} label={scopeLabel} />
          <MetaSep />
          <span className="min-w-0 truncate">{item.triggerSummary}</span>
          <MetaSep />
          <span className="min-w-0 truncate">{item.actionSummary}</span>
          {item.runCount > 0 && (
            <>
              <MetaSep />
              <span className="tabular-nums">
                {item.runCount} run{item.runCount !== 1 ? 's' : ''}
              </span>
            </>
          )}
          {item.lastError && (
            <>
              <MetaSep />
              <Tooltip content={item.lastError}>
                <span className="max-w-[10rem] truncate text-destructive">{item.lastError}</span>
              </Tooltip>
            </>
          )}
        </>
      }
      trail={
        item.isSystem ? (
          // System automations are immutable server-side; offering Run/Disable/
          // Delete here invited taps that could only fail.
          <Tooltip content="System automation — managed by the app and read-only">
            <span className="inline-flex items-center gap-1 px-1.5 text-xs text-muted-foreground">
              <Shield size={12} strokeWidth={1.75} aria-hidden />
              Read-only
            </span>
          </Tooltip>
        ) : (
          <>
            <Tooltip content="Run now">
              <IconButton onClick={onTrigger} aria-label="Run now">
                <Play size={12} />
              </IconButton>
            </Tooltip>
            <Tooltip content={item.enabled ? 'Disable' : 'Enable'}>
              <IconButton onClick={onToggle} aria-label={item.enabled ? 'Disable' : 'Enable'}>
                {item.enabled ? <Pause size={12} /> : <Play size={12} />}
              </IconButton>
            </Tooltip>
            <Tooltip content="Delete">
              <IconButton onClick={onDelete} aria-label="Delete" className="hover:text-destructive">
                <Trash2 size={12} />
              </IconButton>
            </Tooltip>
          </>
        )
      }
    />
  );
}
