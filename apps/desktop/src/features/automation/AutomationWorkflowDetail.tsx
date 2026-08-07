import { useState, useEffect } from 'react';
import { SECTION_LABEL } from '../../components/ui/typography';
import { Loader2 } from 'lucide-react';
import type { Workflow, WorkflowTemplate } from '@zclaudia/shared';
import type { AutomationApiType } from './useAutomationApi';
import type { ProjectInfo } from './automation-types';
import { isInternalProject, CATEGORY_COLORS } from './automation-types';
import { WorkflowEditor } from '../workflows/components/WorkflowEditor';
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
}

function EmptyStatePanel({
  api,
  effectiveProjectId,
  selectedIsGlobal,
  onTemplateEnabled,
}: EmptyStatePanelProps) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);

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

  const handleEnableTemplate = async (templateId: string, projId: string) => {
    await api.post(`/api/projects/${projId}/workflows/from-template/${templateId}`).catch(() => {});
    onTemplateEnabled();
  };

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-6">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">Select a workflow to view or edit</p>
      </div>

      {templates.length > 0 && !selectedIsGlobal && (
        <div className="w-full max-w-lg">
          <h3 className={`${SECTION_LABEL} mb-2`}>Quick Start Templates</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
      <WorkflowEditor
        workflow={workflow}
        projectId={workflow.projectId || effectiveProjectId}
        readOnly={!!workflow.isSystem}
        onBack={() => selectItem(null)}
        onSaved={() => bump()}
      />
    </div>
  );
}
