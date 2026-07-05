import {
  Home,
  Workflow,
  Zap,
  Blocks,
  History,
  Server,
  ArrowLeft,
  Bot,
  SlidersHorizontal,
} from 'lucide-react';
import type { AutomationTab } from '../automation/automation-types';
import type { AgentsTab } from '../agents/agents-types';

export interface SidebarAutomationNavMode {
  tab: AutomationTab;
  onSelectTab: (tab: AutomationTab) => void;
  onBack: () => void;
}

export interface SidebarAgentsNavMode {
  tab: AgentsTab;
  onSelectTab: (tab: AgentsTab) => void;
  onBack: () => void;
}

interface SidebarNavProps {
  /** Navigate to the welcome screen (deselect session + exit any dashboard). */
  onHome: () => void;
  /** Whether the welcome screen is currently showing (no session, no dashboard). */
  isHomeActive: boolean;
  /** Open automations mode. Omitted (e.g. on mobile) hides the entry. */
  onOpenAutomations?: () => void;
  /** When present, the nav renders the automation tabs instead of app destinations. */
  automationMode?: SidebarAutomationNavMode;
  /** Open agents mode. Omitted (e.g. on mobile) hides the entry. */
  onOpenAgents?: () => void;
  /** When present, the nav renders the agents tabs instead of app destinations. */
  agentsMode?: SidebarAgentsNavMode;
  isMobile?: boolean;
}

const AUTOMATION_TABS: { key: AutomationTab; label: string; Icon: typeof Zap }[] = [
  { key: 'automations', label: 'Automations', Icon: Zap },
  { key: 'activity', label: 'Activity', Icon: Blocks },
  { key: 'workflows', label: 'Workflows', Icon: Workflow },
  { key: 'runs', label: 'Runs', Icon: History },
  { key: 'system', label: 'System', Icon: Server },
];

const AGENTS_TABS: { key: AgentsTab; label: string; Icon: typeof Bot }[] = [
  { key: 'profiles', label: 'Profiles', Icon: SlidersHorizontal },
];

/**
 * Top-of-sidebar navigation cluster. In normal mode it lists app-level
 * destinations (Home, Automations). In automation mode it lists a Back row plus
 * the automation tabs. Pinned above the scrollable project list.
 */
export function SidebarNav({
  onHome,
  isHomeActive,
  onOpenAutomations,
  automationMode,
  onOpenAgents,
  agentsMode,
  isMobile,
}: SidebarNavProps) {
  const rowBase = isMobile
    ? 'w-full text-left px-3 py-3 rounded-md text-sm hover:bg-secondary active:bg-secondary hover:text-foreground flex items-center gap-2'
    : 'w-full text-left px-2 py-1.5 rounded-md text-sm hover:bg-secondary hover:text-foreground flex items-center gap-2';
  const iconSize = isMobile ? 'w-5 h-5' : 'w-4 h-4';

  if (automationMode) {
    return (
      <>
        <div className="p-2 space-y-0.5">
          <button
            onClick={automationMode.onBack}
            aria-label="Back to app"
            className={`${rowBase} text-muted-foreground`}
          >
            <ArrowLeft className={iconSize} strokeWidth={1.75} />
            Back to app
          </button>

          {AUTOMATION_TABS.map(({ key, label, Icon }) => {
            const active = automationMode.tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => automationMode.onSelectTab(key)}
                aria-label={label}
                className={`${rowBase} ${active ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`}
              >
                <Icon className={iconSize} strokeWidth={1.75} />
                {label}
              </button>
            );
          })}
        </div>
        <div className="mx-3 border-t border-border" aria-hidden />
      </>
    );
  }

  if (agentsMode) {
    return (
      <>
        <div className="p-2 space-y-0.5">
          <button
            onClick={agentsMode.onBack}
            aria-label="Back to app"
            className={`${rowBase} text-muted-foreground`}
          >
            <ArrowLeft className={iconSize} strokeWidth={1.75} />
            Back to app
          </button>

          {AGENTS_TABS.map(({ key, label, Icon }) => {
            const active = agentsMode.tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => agentsMode.onSelectTab(key)}
                aria-label={label}
                className={`${rowBase} ${active ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`}
              >
                <Icon className={iconSize} strokeWidth={1.75} />
                {label}
              </button>
            );
          })}
        </div>
        <div className="mx-3 border-t border-border" aria-hidden />
      </>
    );
  }

  return (
    <>
      <div className="p-2 space-y-0.5">
        <button
          onClick={onHome}
          aria-label="Home"
          className={`${rowBase} ${isHomeActive ? 'bg-secondary text-foreground' : 'text-muted-foreground'}`}
        >
          <Home className={iconSize} strokeWidth={1.75} />
          Home
        </button>

        {onOpenAutomations && (
          <button
            onClick={onOpenAutomations}
            aria-label="Automations"
            className={`${rowBase} text-muted-foreground`}
          >
            <Zap className={iconSize} strokeWidth={1.75} />
            Automations
          </button>
        )}

        {onOpenAgents && (
          <button
            onClick={onOpenAgents}
            aria-label="Agents"
            className={`${rowBase} text-muted-foreground`}
          >
            <Bot className={iconSize} strokeWidth={1.75} />
            Agents
          </button>
        )}
      </div>
      {/* Inset section divider — see SidebarFooter's twin above Settings */}
      <div className="mx-3 border-t border-border" aria-hidden />
    </>
  );
}
