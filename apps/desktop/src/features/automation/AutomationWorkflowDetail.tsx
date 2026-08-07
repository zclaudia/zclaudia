import { useState, useEffect } from 'react';
import { SECTION_LABEL } from '../../components/ui/typography';
import { Loader2 } from 'lucide-react';
import type { Workflow, WorkflowTemplate } from '@zclaudia/shared';
import type { AutomationApiType } from './useAutomationApi';
import type { ProjectInfo } from './automation-types';
import { isInternalProject, CATEGORY_COLORS } from './automation-types';
import { WorkflowEditor } from '../workflows/components/WorkflowEditor';
import { WorkflowMobileView } from '../workflows/components/WorkflowMobileView';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';

const PERMISSION_FALLBACK_TEMPLATE_ID = 'permission-escalation-default';

interface AutomationWorkflowDetailProps {
  api: AutomationApiType;
  projects: ProjectInfo[];
  projectId?: string;
}

export function AutomationWorkflowDetail({
  api,
  projects,
  projectId,
}: AutomationWorkflowDetailProps) {
  const selectedId = useTopLevelViewStore(s => s.selectedAutomationItemId);
  const selectItem = useTopLevelViewStore(s => s.selectAutomationItem);
  const bump = useTopLevelViewStore(s => s.bumpAutomationListRefresh);

  const effectiveProjectId = projectId ?? '';
  const selectedProject = projects.find(p => p.id === effectiveProjectId);
  const selectedIsGlobal = selectedProject ? isInternalProject(selectedProject.name) : false;

  if (!selectedId) {
    return (
      <EmptyStatePanel
        api={api}
        effectiveProjectId={effectiveProjectId}
        selectedIsGlobal={selectedIsGlobal}
        onTemplateEnabled={bump}
        onSelect={selectItem}
      />
    );
  }

  return (
    <WorkflowDetailPanel
      api={api}
      selectedId={selectedId}
      effectiveProjectId={effectiveProjectId}
      selectItem={selectItem}
      bump={bump}
    />
  );
}

// ----- Empty state panel -----

interface EmptyStatePanelProps {
  api: AutomationApiType;
  effectiveProjectId: string;
  selectedIsGlobal: boolean;
  onTemplateEnabled: () => void;
  onSelect: (id: string) => void;
}

function EmptyStatePanel({
  api,
  effectiveProjectId,
  selectedIsGlobal,
  onTemplateEnabled,
  onSelect,
}: EmptyStatePanelProps) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const refreshNonce = useTopLevelViewStore(s => s.automationListRefreshNonce);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/workflow-templates')
      .then((tpls: WorkflowTemplate[]) => {
        if (!cancelled) {
          setTemplates(
            tpls.filter((t: WorkflowTemplate) => t.id !== PERMISSION_FALLBACK_TEMPLATE_ID)
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api]);

  // The sidebar tree is the only other route to a workflow, and on a phone that
  // tree lives in a drawer which closes the moment a project row is tapped — so
  // without this list an enabled workflow could not be opened at all.
  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/workflows')
      .then((list: Workflow[]) => {
        if (cancelled) return;
        setWorkflows(
          list.filter(w =>
            selectedIsGlobal || !effectiveProjectId
              ? !w.projectId
              : w.projectId === effectiveProjectId
          )
        );
      })
      .catch(() => {
        if (!cancelled) setWorkflows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, effectiveProjectId, selectedIsGlobal, refreshNonce]);

  const handleEnableTemplate = async (templateId: string, projId: string) => {
    await api.post(`/api/projects/${projId}/workflows/from-template/${templateId}`).catch(() => {});
    onTemplateEnabled();
  };

  return (
    <div className="flex h-full flex-col items-center gap-6 p-6">
      {workflows.length > 0 ? (
        <div className="w-full max-w-lg">
          <h3 className={`${SECTION_LABEL} mb-2`}>Workflows</h3>
          <div className="space-y-1.5">
            {workflows.map(w => (
              <button
                key={w.id}
                type="button"
                onClick={() => onSelect(w.id)}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-secondary/40"
              >
                <span
                  className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                    w.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground/40'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{w.name}</span>
                  {w.description && (
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                      {w.description}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="pt-6 text-center">
          <p className="text-sm text-muted-foreground">No workflows yet — enable one below.</p>
        </div>
      )}

      {templates.length > 0 && !selectedIsGlobal && (
        <div className="w-full max-w-lg">
          <h3 className={`${SECTION_LABEL} mb-2`}>Quick Start Templates</h3>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {templates.map(t => (
              <div
                key={t.id}
                className="rounded-lg border border-border bg-card p-3 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-medium">{t.name}</div>
                    {t.description && (
                      <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                        {t.description}
                      </div>
                    )}
                  </div>
                  {(t as any).category && (
                    <span
                      className={`px-1.5 py-0.5 rounded-md text-[9px] font-medium shrink-0 ${CATEGORY_COLORS[(t as any).category] ?? 'bg-muted text-muted-foreground'}`}
                    >
                      {(t as any).category}
                    </span>
                  )}
                </div>
                {effectiveProjectId && (
                  <button
                    onClick={() => handleEnableTemplate(t.id, effectiveProjectId)}
                    className="self-start text-[10px] px-2 py-0.5 rounded-md transition-colors bg-muted/60 text-primary hover:bg-muted max-md:px-3 max-md:py-2 max-md:text-xs"
                  >
                    Enable
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ----- Workflow detail panel -----

interface WorkflowDetailPanelProps {
  api: AutomationApiType;
  selectedId: string;
  effectiveProjectId: string;
  selectItem: (id: string | null) => void;
  bump: () => void;
}

function WorkflowDetailPanel({
  api,
  selectedId,
  effectiveProjectId,
  selectItem,
  bump,
}: WorkflowDetailPanelProps) {
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
          <button
            onClick={() => selectItem(null)}
            className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-secondary"
          >
            Back
          </button>
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
