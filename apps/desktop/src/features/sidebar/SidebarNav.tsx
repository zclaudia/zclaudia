import {
  Home,
  Workflow,
  Zap,
  Blocks,
  History,
  Server,
  ArrowLeft,
  Bot,
  BotMessageSquare,
  Lightbulb,
  Database,
  Plug,
  Search,
  ToyBrick,
  LayoutPanelTop,
} from 'lucide-react';
import { BrandMark } from '../../components/BrandMark';
import type { AutomationTab } from '../automation/automation-types';
import type { AgentsTab } from '../agents/agents-types';
import type { PluginsTab } from '../plugins/plugins-types';

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

export interface SidebarPluginsNavMode {
  tab: PluginsTab;
  onSelectTab: (tab: PluginsTab) => void;
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
  /** Open plugins mode. Omitted (e.g. on mobile) hides the entry. */
  onOpenPlugins?: () => void;
  /** When present, the nav renders the plugins tabs instead of app destinations. */
  pluginsMode?: SidebarPluginsNavMode;
  /** Open the Claudia panel. Mobile only — on desktop it has its own chrome. */
  onOpenClaudia?: () => void;
  isClaudiaActive?: boolean;
  /** Drives the trailing status dot on the Claudia row. */
  claudiaStatus?: 'permission' | 'unread' | 'running' | null;
  isMobile?: boolean;
}

const AUTOMATION_TABS: { key: AutomationTab; label: string; Icon: typeof Zap }[] = [
  { key: 'activity', label: 'Activity', Icon: Blocks },
  { key: 'workflows', label: 'Workflows', Icon: Workflow },
  { key: 'automations', label: 'Automations', Icon: Zap },
  { key: 'system', label: 'System', Icon: Server },
  { key: 'runs', label: 'Runs', Icon: History },
];

const AGENTS_TABS: { key: AgentsTab; label: string; Icon: typeof Bot }[] = [
  { key: 'profiles', label: 'Agent Profiles', Icon: BotMessageSquare },
  { key: 'providers', label: 'LLM Providers', Icon: Plug },
  { key: 'skills', label: 'Skills', Icon: Lightbulb },
  { key: 'mcp-servers', label: 'MCP Servers', Icon: Database },
];

const PLUGINS_TABS: { key: PluginsTab; label: string; Icon: typeof Zap }[] = [
  { key: 'built-in', label: 'Built-in', Icon: LayoutPanelTop },
  { key: 'plugins', label: 'Plugins', Icon: ToyBrick },
  { key: 'web-search', label: 'Web Search', Icon: Search },
];

/**
 * Shared shell for the automation/agents mode navs: a Back-to-app row followed
 * by the mode's tab rows, with the inset section divider underneath. In-file
 * only — both mode branches of SidebarNav render through this.
 */
function ModeTabsNav<K extends string>({
  tabs,
  activeKey,
  onSelect,
  onBack,
  rowClass,
  iconClass,
}: {
  tabs: { key: K; label: string; Icon: typeof Zap }[];
  activeKey: K;
  onSelect: (key: K) => void;
  onBack: () => void;
  rowClass: (active: boolean) => string;
  iconClass: (active: boolean) => string;
}) {
  return (
    <>
      <div className="p-2 space-y-0.5">
        <button onClick={onBack} aria-label="Back to app" className={rowClass(false)}>
          <ArrowLeft className={iconClass(false)} strokeWidth={1.75} />
          Back to app
        </button>

        {tabs.map(({ key, label, Icon }) => {
          const active = activeKey === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              aria-label={label}
              className={rowClass(active)}
            >
              <Icon className={iconClass(active)} strokeWidth={1.75} />
              {label}
            </button>
          );
        })}
      </div>
      <div className="mx-3 border-t border-border" aria-hidden />
    </>
  );
}

/**
 * Top-of-sidebar navigation cluster. In normal mode it lists app-level
 * destinations (Home, Agents, Automations). In automation or agents mode it
 * lists a Back row plus that mode's tabs. Pinned above the scrollable list.
 */
export function SidebarNav({
  onHome,
  isHomeActive,
  onOpenAutomations,
  automationMode,
  onOpenAgents,
  agentsMode,
  onOpenPlugins,
  pluginsMode,
  onOpenClaudia,
  isClaudiaActive,
  claudiaStatus,
  isMobile,
}: SidebarNavProps) {
  // Mobile rows are a 44px touch tier and sit at full foreground: navigation
  // used to render muted while the smaller tree rows rendered foreground/600,
  // which inverted the hierarchy. Depth now reads from inset and weight.
  const rowBase = isMobile
    ? 'w-full text-left px-3 h-11 rounded-md text-sm font-medium hover:bg-secondary active:bg-secondary flex items-center gap-3'
    : 'w-full text-left px-2 py-1.5 rounded-md text-sm hover:bg-secondary hover:text-foreground flex items-center gap-2';
  const iconSize = isMobile ? 'w-5 h-5' : 'w-4 h-4';
  const rowClass = (active: boolean) =>
    `${rowBase} ${
      active
        ? 'bg-secondary text-foreground'
        : isMobile
          ? 'text-foreground'
          : 'text-muted-foreground'
    }`;
  // The label carries the hierarchy, so the glyph stays muted until the row is
  // active (on desktop the whole row is muted and the icon inherits it).
  const iconClass = (active: boolean) =>
    isMobile && !active ? `${iconSize} text-muted-foreground` : iconSize;

  if (automationMode) {
    return (
      <ModeTabsNav
        tabs={AUTOMATION_TABS}
        activeKey={automationMode.tab}
        onSelect={automationMode.onSelectTab}
        onBack={automationMode.onBack}
        rowClass={rowClass}
        iconClass={iconClass}
      />
    );
  }

  if (agentsMode) {
    return (
      <ModeTabsNav
        tabs={AGENTS_TABS}
        activeKey={agentsMode.tab}
        onSelect={agentsMode.onSelectTab}
        onBack={agentsMode.onBack}
        rowClass={rowClass}
        iconClass={iconClass}
      />
    );
  }

  if (pluginsMode) {
    return (
      <ModeTabsNav
        tabs={PLUGINS_TABS}
        activeKey={pluginsMode.tab}
        onSelect={pluginsMode.onSelectTab}
        onBack={pluginsMode.onBack}
        rowClass={rowClass}
        iconClass={iconClass}
      />
    );
  }

  return (
    <>
      <div className="p-2 space-y-0.5">
        <button onClick={onHome} aria-label="Home" className={rowClass(!!isHomeActive)}>
          <Home className={iconClass(!!isHomeActive)} strokeWidth={1.75} />
          Home
        </button>

        {onOpenClaudia && (
          // Claudia is a destination, not a global action — it used to be a
          // header icon whose PNG mark painted a solid disc, the brightest
          // thing in the drawer.
          <button
            onClick={onOpenClaudia}
            aria-label="Claudia"
            className={rowClass(!!isClaudiaActive)}
          >
            <BrandMark className={`${iconSize} flex-shrink-0 object-contain`} />
            <span className="flex-1 truncate text-left">Claudia</span>
            {claudiaStatus && !isClaudiaActive && (
              <span
                className={`h-[7px] w-[7px] flex-shrink-0 rounded-full ${
                  claudiaStatus === 'permission'
                    ? 'bg-warning'
                    : claudiaStatus === 'unread'
                      ? 'bg-primary animate-pulse'
                      : 'bg-warning animate-pulse'
                }`}
              />
            )}
          </button>
        )}

        {onOpenAgents && (
          <button onClick={onOpenAgents} aria-label="Agents" className={rowClass(false)}>
            <Bot className={iconClass(false)} strokeWidth={1.75} />
            Agents
          </button>
        )}

        {onOpenPlugins && (
          <button onClick={onOpenPlugins} aria-label="Extensions" className={rowClass(false)}>
            <Blocks className={iconClass(false)} strokeWidth={1.75} />
            Extensions
          </button>
        )}

        {onOpenAutomations && (
          <button onClick={onOpenAutomations} aria-label="Automations" className={rowClass(false)}>
            <Zap className={iconClass(false)} strokeWidth={1.75} />
            Automations
          </button>
        )}
      </div>
      {/* Inset section divider — see SidebarFooter's twin above Settings */}
      <div className="mx-3 border-t border-border" aria-hidden />
    </>
  );
}
