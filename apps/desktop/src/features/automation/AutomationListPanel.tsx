import type { AutomationApiType } from './useAutomationApi';
import type { AutomationTab, ProjectInfo } from './automation-types';
import { AutomationWorkflowList } from './AutomationWorkflowList';

interface AutomationListPanelProps {
  tab: AutomationTab;
  api: AutomationApiType;
  projects: ProjectInfo[];
  projectId?: string;
}

/** Sidebar list for the active automation tab. Only Workflows is migrated to
 *  the master-detail list so far; other tabs render full-pane in the main area. */
export function AutomationListPanel({ tab, api, projects, projectId }: AutomationListPanelProps) {
  if (tab === 'workflows') {
    return <AutomationWorkflowList api={api} projects={projects} projectId={projectId} />;
  }
  return null;
}
