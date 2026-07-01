/**
 * Automation management content rendered inline in the main pane.
 *
 * The active tab is chosen from the sidebar nav; backend/project scope comes from
 * the sidebar hierarchy. This component owns only the per-tab body plus a light
 * title header — no tab strip and no backend dropdown (both live in the sidebar).
 */

import { useState, useEffect, useCallback } from 'react';
import { Zap, Blocks, Workflow, History, Server } from 'lucide-react';
import { useAutomationApi } from './useAutomationApi';
import type { ProjectInfo, AutomationTab } from './automation-types';
import { isInternalProject } from './automation-types';
import { AutomationsTab } from './AutomationsTab';
import { ActivityTab } from './ActivityTab';
import { AutomationWorkflowDetail } from './AutomationWorkflowDetail';
import { RunsTab } from './RunsTab';
import { SystemTasksTab } from './SystemTasksTab';

interface AutomationContentProps {
  tab: AutomationTab;
  projectId?: string;
  backendId: string | null;
}

const TAB_META: Record<AutomationTab, { label: string; Icon: typeof Zap }> = {
  automations: { label: 'Automations', Icon: Zap },
  activity: { label: 'Activity', Icon: Blocks },
  workflows: { label: 'Workflows', Icon: Workflow },
  runs: { label: 'Runs', Icon: History },
  system: { label: 'System', Icon: Server },
};

export function AutomationContent({ tab, projectId, backendId }: AutomationContentProps) {
  const api = useAutomationApi(backendId, '', '');

  const [projects, setProjects] = useState<ProjectInfo[]>([]);

  useEffect(() => {
    setProjects([]);
    api.get('/api/projects').then((projectData) => {
      setProjects(projectData);
    }).catch(() => {});
  }, [api]);

  const projectName = useCallback((id?: string) => {
    if (!id) return 'Global';
    const project = projects.find(p => p.id === id);
    if (!project) return id.slice(0, 8);
    return isInternalProject(project.name) ? 'Global' : project.name;
  }, [projects]);

  const meta = TAB_META[tab];
  const scopeKey = backendId || 'fallback';
  const MetaIcon = meta.Icon;

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <MetaIcon size={17} className="text-primary" />
        <h1 className="text-sm font-semibold">{meta.label}</h1>
        {projectId && projects.length > 0 && (
          <span className="text-xs text-muted-foreground">· {projectName(projectId)}</span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tab === 'automations' && (
          <AutomationsTab
            key={`automations-${scopeKey}`}
            api={api}
            projectName={projectName}
            projectId={projectId}
          />
        )}
        {tab === 'activity' && <ActivityTab key={`activity-${scopeKey}`} api={api} />}
        {tab === 'workflows' && (
          <AutomationWorkflowDetail
            key={`workflows-${scopeKey}`}
            api={api}
            projects={projects}
            projectId={projectId}
          />
        )}
        {tab === 'runs' && (
          <RunsTab key={`runs-${scopeKey}`} api={api} projectId={projectId} />
        )}
        {tab === 'system' && <SystemTasksTab key={`system-${scopeKey}`} api={api} />}
      </div>
    </div>
  );
}
