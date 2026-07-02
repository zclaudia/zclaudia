import { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, Play, Trash2, Shield } from 'lucide-react';
import type { Workflow } from '@zclaudia/shared';
import type { AutomationApiType } from './useAutomationApi';
import type { ProjectInfo } from './automation-types';
import { isInternalProject } from './automation-types';
import { LoadingState, EmptyState } from './AutomationSharedComponents';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';

interface AutomationWorkflowListProps {
  api: AutomationApiType;
  projects: ProjectInfo[];
  projectId?: string;
}

export function AutomationWorkflowList({ api, projects, projectId }: AutomationWorkflowListProps) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);

  const selectedId = useTopLevelViewStore(s => s.selectedAutomationItemId);
  const selectItem = useTopLevelViewStore(s => s.selectAutomationItem);
  const refreshNonce = useTopLevelViewStore(s => s.automationListRefreshNonce);

  const effectiveProjectId = projectId ?? '';
  const selectedProject = projects.find(p => p.id === effectiveProjectId);
  const selectedIsGlobal = selectedProject ? isInternalProject(selectedProject.name) : false;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const query =
        selectedIsGlobal || !effectiveProjectId
          ? ''
          : `?projectId=${encodeURIComponent(effectiveProjectId)}`;
      const wfs = await api.get(`/api/workflows${query}`);
      const scoped = selectedIsGlobal ? wfs.filter((w: Workflow) => !w.projectId) : wfs;
      setWorkflows(scoped);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [api, effectiveProjectId, selectedIsGlobal]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshNonce]);

  const handleCreate = async () => {
    if (!effectiveProjectId) return;
    const name = `New Workflow ${new Date().toLocaleTimeString()}`;
    const result = await api
      .post(`/api/projects/${effectiveProjectId}/workflows`, {
        name,
        definition: { nodes: [], edges: [], entryNodeId: '' },
      })
      .catch(() => null);
    await refresh();
    if (result && result.id) {
      selectItem(result.id);
    }
  };

  const handleTrigger = async (id: string) => {
    await api.post(`/api/workflows/${id}/trigger`).catch(() => {});
    refresh();
  };

  const handleDelete = async (id: string) => {
    await api.del(`/api/workflows/${id}`).catch(() => {});
    if (selectedId === id) selectItem(null);
    setWorkflows(prev => prev.filter(w => w.id !== id));
  };

  if (loading) return <LoadingState />;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 shrink-0">
        <span className="text-xs font-medium text-muted-foreground">
          Workflows
          {workflows.length > 0 && (
            <span className="ml-1 text-[10px] opacity-60">({workflows.length})</span>
          )}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleCreate}
            disabled={!effectiveProjectId}
            aria-label="New"
            title={!effectiveProjectId ? 'Select a project to create a workflow' : 'New workflow'}
            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-muted/60 text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-muted/60"
          >
            <Plus size={11} />
            New
          </button>
          <button
            onClick={refresh}
            className="p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* List */}
      {workflows.length === 0 ? (
        <EmptyState message="No workflows yet" subtitle="Create one to get started" />
      ) : (
        <div className="flex-1 overflow-y-auto space-y-0.5 px-1 pb-2">
          {workflows.map(w => {
            const isSelected = selectedId === w.id;
            const isSystem = !!w.isSystem;
            const showTrigger = w.status === 'active';
            const showDelete = !isSystem;
            // Reserve right padding for the action buttons so they don't overlap the name.
            const actionPadding =
              showTrigger && showDelete ? 'pr-12' : showTrigger || showDelete ? 'pr-7' : '';
            return (
              <div key={w.id} className="relative group">
                <button
                  onClick={() => selectItem(w.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${actionPadding} ${
                    isSelected
                      ? 'bg-secondary text-foreground'
                      : 'hover:bg-secondary/50 text-foreground'
                  }`}
                >
                  {/* Status dot */}
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      w.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground/40'
                    }`}
                    aria-hidden
                  />

                  {/* Name + system badge */}
                  <span className="flex-1 min-w-0 flex items-center gap-1.5">
                    <span className="text-xs truncate">{w.name}</span>
                    {isSystem && (
                      <Shield
                        size={9}
                        className="shrink-0 text-muted-foreground"
                        aria-label="System Default"
                      />
                    )}
                  </span>
                </button>

                {/* Action buttons — siblings of the row button, revealed on hover */}
                {(showTrigger || showDelete) && (
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {showTrigger && (
                      <button
                        type="button"
                        aria-label="Trigger"
                        onClick={e => {
                          e.stopPropagation();
                          handleTrigger(w.id);
                        }}
                        className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                        title="Trigger"
                      >
                        <Play size={11} />
                      </button>
                    )}
                    {showDelete && (
                      <button
                        type="button"
                        aria-label="Delete"
                        onClick={e => {
                          e.stopPropagation();
                          handleDelete(w.id);
                        }}
                        className="p-0.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
