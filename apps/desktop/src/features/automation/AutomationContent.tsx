/**
 * Automation management content rendered inline in the main pane.
 *
 * The active tab is chosen from the sidebar nav. Backend / project scope is
 * the Agents shell's model: every online backend is fetched in parallel and a
 * Backend chip row in each tab narrows to one (then a Project row appears).
 * This component owns the light title header and the shared scope plumbing;
 * each tab renders its own toolbar, chips and rows.
 */
import { useMemo } from 'react';
import { Zap, Blocks, Workflow, History, Server, ServerOff } from 'lucide-react';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import type { AutomationTab, AutomationBackend } from './automation-types';
import { AutomationsTab } from './AutomationsTab';
import { ActivityTab } from './ActivityTab';
import { AutomationWorkflowDetail } from './AutomationWorkflowDetail';
import { RunsTab } from './RunsTab';
import { SystemTasksTab } from './SystemTasksTab';
import { EmptyState } from './AutomationSharedComponents';
import {
  useAutomationBackends,
  scopedBackends,
  isGroupedByBackend,
} from './useAutomationByBackend';
import { useProjectsByBackend, type ProjectInfoLite } from './AutomationScope';
import type { ByBackend } from './useAutomationByBackend';

interface AutomationContentProps {
  tab: AutomationTab;
}

/** Scope every tab receives. */
export interface AutomationTabScope {
  /** Every known backend (for the chip row; offline ones render dimmed). */
  allBackends: AutomationBackend[];
  /** The online backends the tab fetches from under the current filter. */
  backends: AutomationBackend[];
  /** Rows sit under per-backend headers. */
  grouped: boolean;
  /** Project filter; only set while a single backend is selected. */
  projectId?: string;
  /** Projects per backend, for naming a row's scope. */
  projects: ByBackend<ProjectInfoLite[]>;
}

const TAB_META: Record<AutomationTab, { label: string; Icon: typeof Zap }> = {
  automations: { label: 'Automations', Icon: Zap },
  activity: { label: 'Activity', Icon: Blocks },
  workflows: { label: 'Workflows', Icon: Workflow },
  runs: { label: 'Runs', Icon: History },
  system: { label: 'System', Icon: Server },
};

export function AutomationContent({ tab }: AutomationContentProps) {
  const isMobile = useIsMobile();
  const allBackends = useAutomationBackends();
  const backendFilter = useTopLevelViewStore(s => s.automationBackendFilter);
  const viewProjectId = useTopLevelViewStore(s =>
    s.view.kind === 'automations' ? s.view.projectId : undefined
  );

  const backends = useMemo(
    () => scopedBackends(allBackends, backendFilter),
    [allBackends, backendFilter]
  );
  const grouped = isGroupedByBackend(allBackends, backendFilter);
  const projectId = backendFilter !== 'all' ? viewProjectId : undefined;
  const projects = useProjectsByBackend(backends);

  const scope: AutomationTabScope = useMemo(
    () => ({ allBackends, backends, grouped, projectId, projects }),
    [allBackends, backends, grouped, projectId, projects]
  );

  const meta = TAB_META[tab];
  const MetaIcon = meta.Icon;
  // On mobile MobileModeHeader already titles the mode, so this bar would just
  // repeat "Automations". Keep it only when it names a different tab.
  const showTabBar = !isMobile || tab !== 'automations';
  const anyOnline = allBackends.some(b => b.online);

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <div
        className={`items-center gap-2 px-4 py-3 border-b border-border ${showTabBar ? 'flex' : 'hidden'}`}
      >
        <MetaIcon size={17} className="text-primary" />
        <h1 className="text-sm font-semibold">{meta.label}</h1>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {!anyOnline ? (
          <EmptyState
            icon={ServerOff}
            message="No backends online"
            subtitle="Connect a backend to see its automations."
          />
        ) : (
          <>
            {tab === 'automations' && <AutomationsTab scope={scope} />}
            {tab === 'activity' && <ActivityTab scope={scope} />}
            {tab === 'workflows' && <AutomationWorkflowDetail scope={scope} />}
            {tab === 'runs' && <RunsTab scope={scope} />}
            {tab === 'system' && <SystemTasksTab scope={scope} />}
          </>
        )}
      </div>
    </div>
  );
}
