import { useState, useEffect, useMemo } from 'react';
import { Loader2, RefreshCw, ChevronRight, Workflow as WorkflowIcon } from 'lucide-react';
import type { Workflow, WorkflowTemplate } from '@zclaudia/shared';
import { categoryTone } from './automation-types';
import type { AutomationBackend } from './automation-types';
import { Button, IconButton } from '../../components/ui/Button';
import { Tooltip } from '../../components/ui/Tooltip';
import { WorkflowEditor } from '../workflows/components/WorkflowEditor';
import { WorkflowMobileView } from '../workflows/components/WorkflowMobileView';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import { createAutomationApi } from './useAutomationApi';
import { useAutomationByBackend } from './useAutomationByBackend';
import {
  EmptyState,
  TabToolbar,
  SectionGroup,
  ListCard,
  StatusDot,
  ToneBadge,
  MetaSep,
  LoadingState,
} from './AutomationSharedComponents';
import { AutomationScopeChips, BackendGroups, ScopeChunk, projectLabel } from './AutomationScope';
import type { AutomationTabScope } from './AutomationContent';

const PERMISSION_FALLBACK_TEMPLATE_ID = 'permission-escalation-default';

export function AutomationWorkflowDetail({ scope }: { scope: AutomationTabScope }) {
  const selectedId = useTopLevelViewStore(s => s.selectedAutomationItemId);
  const selectedBackendId = useTopLevelViewStore(s => s.selectedAutomationItemBackendId);
  const selectItem = useTopLevelViewStore(s => s.selectAutomationItem);
  const bump = useTopLevelViewStore(s => s.bumpAutomationListRefresh);

  if (!selectedId) {
    return <WorkflowOverview scope={scope} onSelect={selectItem} onTemplateEnabled={bump} />;
  }

  return (
    <WorkflowDetailPanel
      backendId={selectedBackendId ?? scope.backends[0]?.backendId ?? null}
      selectedId={selectedId}
      effectiveProjectId={scope.projectId ?? ''}
      selectItem={selectItem}
      bump={bump}
    />
  );
}

// ----- Overview: workflows per backend + quick-start templates -----

function WorkflowOverview({
  scope,
  onSelect,
  onTemplateEnabled,
}: {
  scope: AutomationTabScope;
  onSelect: (id: string, backendId: string) => void;
  onTemplateEnabled: () => void;
}) {
  const { projectId } = scope;
  const catalog = useAutomationByBackend<Workflow[]>(scope.backends, api =>
    api.get('/api/workflows').then((list: Workflow[]) => {
      const all = list ?? [];
      // A project scope shows that project's workflows plus the global ones it
      // can bind; "All projects" shows everything on the backend.
      return projectId ? all.filter(w => !w.projectId || w.projectId === projectId) : all;
    })
  );
  const total = [...catalog.data.values()].reduce((n, list) => n + list.length, 0);

  // Templates need a target project, so they only show for one backend + one project.
  const templateBackend: AutomationBackend | undefined =
    projectId && scope.backends.length === 1 ? scope.backends[0] : undefined;
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  useEffect(() => {
    if (!templateBackend) {
      setTemplates([]);
      return;
    }
    let cancelled = false;
    createAutomationApi(templateBackend.backendId)
      .get('/api/workflow-templates')
      .then((tpls: WorkflowTemplate[]) => {
        if (!cancelled) {
          setTemplates((tpls ?? []).filter(t => t.id !== PERMISSION_FALLBACK_TEMPLATE_ID));
        }
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [templateBackend]);

  const handleEnableTemplate = async (templateId: string) => {
    if (!templateBackend || !projectId) return;
    await createAutomationApi(templateBackend.backendId)
      .post(`/api/projects/${projectId}/workflows/from-template/${templateId}`)
      .catch(() => {});
    onTemplateEnabled();
    catalog.refresh();
  };

  return (
    <div className="space-y-4">
      <TabToolbar
        unknown={catalog.data.size === 0 && catalog.errors.size > 0}
        count={total}
        noun="workflow"
      >
        <Tooltip content="Refresh">
          <IconButton onClick={catalog.refresh} aria-label="Refresh">
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
          count={items => items.length}
          empty={
            <EmptyState
              icon={WorkflowIcon}
              message="No workflows yet"
              subtitle={
                templates.length > 0
                  ? 'Enable a template below to get started.'
                  : 'Pick a backend and a project to enable a quick-start template.'
              }
            />
          }
          render={(items, backend) => (
            <div className="space-y-1.5">
              {items.map(w => (
                <ListCard
                  key={w.id}
                  onClick={() => onSelect(w.id, backend.backendId)}
                  lead={<StatusDot tone={w.status === 'active' ? 'success' : 'neutral'} />}
                  title={w.name}
                  titleExtra={w.isSystem ? <ToneBadge tone="neutral">System</ToneBadge> : undefined}
                  meta={
                    <>
                      <ScopeChunk
                        projectId={w.projectId}
                        label={projectLabel(scope.projects, backend.backendId, w.projectId)}
                      />
                      {w.description && (
                        <>
                          <MetaSep />
                          <span className="min-w-0 truncate max-md:whitespace-normal">
                            {w.description}
                          </span>
                        </>
                      )}
                    </>
                  }
                  trail={
                    <ChevronRight size={14} strokeWidth={1.75} className="text-muted-foreground" />
                  }
                />
              ))}
            </div>
          )}
        />
      )}

      {templates.length > 0 && (
        <SectionGroup label="Quick start templates">
          {templates.map(t => {
            const category = (t as { category?: string }).category;
            return (
              <ListCard
                key={t.id}
                lead={<WorkflowIcon size={15} strokeWidth={1.75} />}
                title={t.name}
                titleExtra={
                  category ? (
                    <ToneBadge tone={categoryTone(category)}>{category}</ToneBadge>
                  ) : undefined
                }
                meta={
                  t.description ? (
                    <span className="min-w-0 truncate max-md:whitespace-normal">
                      {t.description}
                    </span>
                  ) : undefined
                }
                trail={
                  <Button variant="outline" size="sm" onClick={() => handleEnableTemplate(t.id)}>
                    Enable
                  </Button>
                }
              />
            );
          })}
        </SectionGroup>
      )}
    </div>
  );
}

// ----- Workflow detail panel -----

interface WorkflowDetailPanelProps {
  backendId: string | null;
  selectedId: string;
  effectiveProjectId: string;
  selectItem: (id: string | null) => void;
  bump: () => void;
}

function WorkflowDetailPanel({
  backendId,
  selectedId,
  effectiveProjectId,
  selectItem,
  bump,
}: WorkflowDetailPanelProps) {
  const api = useMemo(() => createAutomationApi(backendId), [backendId]);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setWorkflow(null);

    (async () => {
      try {
        const wf = await api.get('/api/workflows/' + selectedId);
        if (!cancelled) {
          setWorkflow(wf);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load workflow');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, selectedId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-sm text-destructive mb-2">{error ?? 'Workflow not found'}</div>
          <Button variant="outline" onClick={() => selectItem(null)}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      {/* Below md the graph editor is replaced outright rather than adapted:
          the canvas does not fit and its authoring gestures are drag-based.
          Tablets keep the editor — 768px has room for canvas plus a collapsed
          palette, and it is the breakpoint the rest of the app already uses. */}
      <div className="h-full md:hidden">
        <WorkflowMobileView
          workflow={workflow}
          onBack={() => selectItem(null)}
          onRun={
            workflow.isSystem
              ? undefined
              : async () => {
                  await api.post(`/api/workflows/${workflow.id}/trigger`);
                  bump();
                }
          }
        />
      </div>
      <div className="hidden h-full md:block">
        <WorkflowEditor
          workflow={workflow}
          projectId={workflow.projectId || effectiveProjectId}
          readOnly={!!workflow.isSystem}
          onBack={() => selectItem(null)}
          onSaved={() => bump()}
        />
      </div>
    </div>
  );
}
