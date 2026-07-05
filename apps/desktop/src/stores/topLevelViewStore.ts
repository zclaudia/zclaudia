import { create } from 'zustand';
import type { SettingsTab } from '../features/settings/settingsTabDefs';
import type {
  AutomationTab,
  OpenAutomationsOptions,
} from '../features/automation/automation-types';
import type { AgentsTab, AgentsSelection } from '../features/agents/agents-types';

export type TopLevelView =
  | { kind: 'app' }
  | { kind: 'settings'; initialTab?: SettingsTab }
  | { kind: 'automations'; tab: AutomationTab; projectId?: string }
  | { kind: 'agents'; tab: AgentsTab };

interface TopLevelViewState {
  view: TopLevelView;
  selectedAutomationItemId: string | null;
  automationListRefreshNonce: number;
  agentsSelection: AgentsSelection | null;
  agentsRefreshNonce: number;
  openSettings: (initialTab?: SettingsTab) => void;
  openAutomations: (opts?: OpenAutomationsOptions) => void;
  setAutomationTab: (tab: AutomationTab) => void;
  setAutomationProjectFilter: (projectId?: string) => void;
  returnToApp: () => void;
  selectAutomationItem: (id: string | null) => void;
  bumpAutomationListRefresh: () => void;
  openAgents: () => void;
  setAgentsTab: (tab: AgentsTab) => void;
  selectAgentsItem: (sel: AgentsSelection | null) => void;
  bumpAgentsRefresh: () => void;
}

export const useTopLevelViewStore = create<TopLevelViewState>(set => ({
  view: { kind: 'app' },
  selectedAutomationItemId: null,
  automationListRefreshNonce: 0,
  agentsSelection: null,
  agentsRefreshNonce: 0,
  openSettings: initialTab =>
    set({
      view: initialTab ? { kind: 'settings', initialTab } : { kind: 'settings' },
    }),
  openAutomations: opts =>
    set({
      view: {
        kind: 'automations',
        tab: opts?.tab ?? 'automations',
        ...(opts?.projectId ? { projectId: opts.projectId } : {}),
      },
      selectedAutomationItemId: null,
    }),
  setAutomationTab: tab =>
    set(state =>
      state.view.kind === 'automations'
        ? { view: { ...state.view, tab }, selectedAutomationItemId: null }
        : state
    ),
  setAutomationProjectFilter: projectId =>
    set(state =>
      state.view.kind === 'automations'
        ? {
            view: { kind: 'automations', tab: state.view.tab, ...(projectId ? { projectId } : {}) },
          }
        : state
    ),
  returnToApp: () => set({ view: { kind: 'app' }, agentsSelection: null }),
  selectAutomationItem: id => set({ selectedAutomationItemId: id }),
  bumpAutomationListRefresh: () =>
    set(s => ({ automationListRefreshNonce: s.automationListRefreshNonce + 1 })),
  openAgents: () => set({ view: { kind: 'agents', tab: 'profiles' }, agentsSelection: null }),
  setAgentsTab: tab =>
    set(state => (state.view.kind === 'agents' ? { view: { ...state.view, tab } } : state)),
  selectAgentsItem: sel => set({ agentsSelection: sel }),
  bumpAgentsRefresh: () => set(s => ({ agentsRefreshNonce: s.agentsRefreshNonce + 1 })),
}));
