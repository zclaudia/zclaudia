import { describe, it, expect, beforeEach } from 'vitest';
import { useTopLevelViewStore } from '../topLevelViewStore';

describe('topLevelViewStore', () => {
  beforeEach(() => {
    useTopLevelViewStore.setState({
      view: { kind: 'app' },
      selectedAutomationItemId: null,
      automationListRefreshNonce: 0,
    });
  });

  it('starts on the normal app shell', () => {
    expect(useTopLevelViewStore.getState().view).toEqual({ kind: 'app' });
  });

  it('opens Settings without an initial tab', () => {
    useTopLevelViewStore.getState().openSettings();
    expect(useTopLevelViewStore.getState().view).toEqual({ kind: 'settings' });
  });

  it('opens Settings with an initial tab payload', () => {
    useTopLevelViewStore.getState().openSettings('permissions');
    expect(useTopLevelViewStore.getState().view).toEqual({
      kind: 'settings',
      initialTab: 'permissions',
    });
  });

  it('returns to the normal app shell', () => {
    useTopLevelViewStore.getState().openSettings('permissions');
    useTopLevelViewStore.getState().returnToApp();
    expect(useTopLevelViewStore.getState().view).toEqual({ kind: 'app' });
  });

  it('opens Automations with defaults', () => {
    useTopLevelViewStore.getState().openAutomations();
    expect(useTopLevelViewStore.getState().view).toEqual({
      kind: 'automations',
      tab: 'automations',
    });
  });

  it('opens Automations with a tab and project filter', () => {
    useTopLevelViewStore.getState().openAutomations({ tab: 'workflows', projectId: 'p1' });
    expect(useTopLevelViewStore.getState().view).toEqual({
      kind: 'automations',
      tab: 'workflows',
      projectId: 'p1',
    });
  });

  it('switches the automation tab in place', () => {
    useTopLevelViewStore.getState().openAutomations({ projectId: 'p1' });
    useTopLevelViewStore.getState().setAutomationTab('runs');
    expect(useTopLevelViewStore.getState().view).toEqual({
      kind: 'automations',
      tab: 'runs',
      projectId: 'p1',
    });
  });

  it('sets and clears the automation project filter in place', () => {
    useTopLevelViewStore.getState().openAutomations();
    useTopLevelViewStore.getState().setAutomationProjectFilter('p2');
    expect(useTopLevelViewStore.getState().view).toEqual({
      kind: 'automations',
      tab: 'automations',
      projectId: 'p2',
    });
    useTopLevelViewStore.getState().setAutomationProjectFilter(undefined);
    expect(useTopLevelViewStore.getState().view).toEqual({
      kind: 'automations',
      tab: 'automations',
    });
  });

  it('ignores automation mutators when not in automations view', () => {
    useTopLevelViewStore.getState().openSettings();
    useTopLevelViewStore.getState().setAutomationTab('runs');
    useTopLevelViewStore.getState().setAutomationProjectFilter('p1');
    expect(useTopLevelViewStore.getState().view).toEqual({ kind: 'settings' });
  });
});

describe('topLevelViewStore automation selection', () => {
  beforeEach(() => {
    useTopLevelViewStore.setState({
      view: { kind: 'app' },
      selectedAutomationItemId: null,
      automationListRefreshNonce: 0,
    });
  });

  it('selectAutomationItem sets the id', () => {
    useTopLevelViewStore.getState().selectAutomationItem('wf-1');
    expect(useTopLevelViewStore.getState().selectedAutomationItemId).toBe('wf-1');
  });

  it('setAutomationTab resets the selection to null', () => {
    useTopLevelViewStore.getState().openAutomations({ tab: 'workflows' });
    useTopLevelViewStore.getState().selectAutomationItem('wf-1');
    useTopLevelViewStore.getState().setAutomationTab('runs');
    expect(useTopLevelViewStore.getState().selectedAutomationItemId).toBeNull();
  });

  it('openAutomations initializes selection to null', () => {
    useTopLevelViewStore.getState().selectAutomationItem('wf-1');
    useTopLevelViewStore.getState().openAutomations({ tab: 'workflows' });
    expect(useTopLevelViewStore.getState().selectedAutomationItemId).toBeNull();
  });

  it('bumpAutomationListRefresh increments the nonce', () => {
    const before = useTopLevelViewStore.getState().automationListRefreshNonce;
    useTopLevelViewStore.getState().bumpAutomationListRefresh();
    expect(useTopLevelViewStore.getState().automationListRefreshNonce).toBe(before + 1);
  });
});

describe('agents view', () => {
  beforeEach(() => {
    useTopLevelViewStore.setState({
      view: { kind: 'app' },
      selectedAutomationItemId: null,
      automationListRefreshNonce: 0,
      agentsSelection: null,
      agentsRefreshNonce: 0,
    });
  });

  it('openAgents enters agents mode on the profiles tab with no selection', () => {
    useTopLevelViewStore.getState().openAgents();
    const s = useTopLevelViewStore.getState();
    expect(s.view).toEqual({ kind: 'agents', tab: 'profiles' });
    expect(s.agentsSelection).toBeNull();
  });

  it('openAgents accepts a tab for readiness deep-links', () => {
    useTopLevelViewStore.getState().openAgents('providers');
    const s = useTopLevelViewStore.getState();
    expect(s.view).toEqual({ kind: 'agents', tab: 'providers' });
    expect(s.agentsSelection).toBeNull();
  });

  it('openAgents with a tab clears an existing selection', () => {
    useTopLevelViewStore.getState().openAgents();
    useTopLevelViewStore
      .getState()
      .selectAgentsItem({ backendId: 'b1', kind: 'llm-profile', id: 'lp1' });
    useTopLevelViewStore.getState().openAgents('providers');
    expect(useTopLevelViewStore.getState().agentsSelection).toBeNull();
  });

  it('selectAgentsItem stores backend-scoped selection', () => {
    useTopLevelViewStore.getState().openAgents();
    useTopLevelViewStore
      .getState()
      .selectAgentsItem({ backendId: 'b1', kind: 'profile', id: 'p1' });
    expect(useTopLevelViewStore.getState().agentsSelection).toEqual({
      backendId: 'b1',
      kind: 'profile',
      id: 'p1',
    });
  });

  it('openAgents clears an existing selection', () => {
    useTopLevelViewStore.getState().openAgents();
    useTopLevelViewStore
      .getState()
      .selectAgentsItem({ backendId: 'b1', kind: 'profile', id: 'p1' });
    useTopLevelViewStore.getState().openAgents();
    expect(useTopLevelViewStore.getState().agentsSelection).toBeNull();
  });

  it('selectAgentsItem(null) clears the selection', () => {
    useTopLevelViewStore.getState().openAgents();
    useTopLevelViewStore.getState().selectAgentsItem({ backendId: 'b1', kind: 'new-profile' });
    useTopLevelViewStore.getState().selectAgentsItem(null);
    expect(useTopLevelViewStore.getState().agentsSelection).toBeNull();
  });

  it('setAgentsTab clears the selection while in agents view', () => {
    useTopLevelViewStore.getState().openAgents();
    useTopLevelViewStore
      .getState()
      .selectAgentsItem({ backendId: 'b1', kind: 'profile', id: 'p1' });
    useTopLevelViewStore.getState().setAgentsTab('profiles');
    const s = useTopLevelViewStore.getState();
    expect(s.view).toEqual({ kind: 'agents', tab: 'profiles' });
    expect(s.agentsSelection).toBeNull();
  });

  it('setAgentsTab switches to skills and clears the selection', () => {
    useTopLevelViewStore.getState().openAgents();
    useTopLevelViewStore
      .getState()
      .selectAgentsItem({ backendId: 'b1', kind: 'profile', id: 'p1' });
    useTopLevelViewStore.getState().setAgentsTab('skills');
    const s = useTopLevelViewStore.getState();
    expect(s.view).toEqual({ kind: 'agents', tab: 'skills' });
    expect(s.agentsSelection).toBeNull();
  });

  it('setAgentsTab switches from skills to mcp-servers and clears the selection', () => {
    useTopLevelViewStore.getState().openAgents();
    useTopLevelViewStore.getState().setAgentsTab('skills');
    useTopLevelViewStore.getState().selectAgentsItem({ backendId: 'b1', kind: 'skill', id: 's1' });
    useTopLevelViewStore.getState().setAgentsTab('mcp-servers');
    const s = useTopLevelViewStore.getState();
    expect(s.view).toEqual({ kind: 'agents', tab: 'mcp-servers' });
    expect(s.agentsSelection).toBeNull();
  });

  it('setAgentsTab switches to providers and clears the selection', () => {
    useTopLevelViewStore.getState().openAgents();
    useTopLevelViewStore
      .getState()
      .selectAgentsItem({ backendId: 'b1', kind: 'llm-profile', id: 'lp1' });
    useTopLevelViewStore.getState().setAgentsTab('providers');
    const s = useTopLevelViewStore.getState();
    expect(s.view).toEqual({ kind: 'agents', tab: 'providers' });
    expect(s.agentsSelection).toBeNull();
  });

  it('ignores setAgentsTab when not in agents view', () => {
    useTopLevelViewStore.getState().openSettings();
    useTopLevelViewStore.getState().setAgentsTab('profiles');
    expect(useTopLevelViewStore.getState().view).toEqual({ kind: 'settings' });
  });

  it('returnToApp clears agents selection', () => {
    useTopLevelViewStore.getState().openAgents();
    useTopLevelViewStore.getState().selectAgentsItem({ backendId: 'b1', kind: 'new-profile' });
    useTopLevelViewStore.getState().returnToApp();
    expect(useTopLevelViewStore.getState().agentsSelection).toBeNull();
  });

  it('bumpAgentsRefresh increments the nonce', () => {
    const before = useTopLevelViewStore.getState().agentsRefreshNonce;
    useTopLevelViewStore.getState().bumpAgentsRefresh();
    expect(useTopLevelViewStore.getState().agentsRefreshNonce).toBe(before + 1);
  });
});

describe('plugins view', () => {
  beforeEach(() => {
    useTopLevelViewStore.setState({
      view: { kind: 'app' },
      selectedAutomationItemId: null,
      automationListRefreshNonce: 0,
      agentsSelection: null,
      agentsRefreshNonce: 0,
    });
  });

  it('openPlugins enters plugins mode on the installed tab', () => {
    useTopLevelViewStore.getState().openPlugins();
    expect(useTopLevelViewStore.getState().view).toEqual({ kind: 'plugins', tab: 'installed' });
  });

  it('openPlugins accepts an explicit tab', () => {
    useTopLevelViewStore.getState().openPlugins('web-search');
    expect(useTopLevelViewStore.getState().view).toEqual({ kind: 'plugins', tab: 'web-search' });
  });

  it('setPluginsTab switches the tab while in plugins view', () => {
    useTopLevelViewStore.getState().openPlugins();
    useTopLevelViewStore.getState().setPluginsTab('builtin');
    expect(useTopLevelViewStore.getState().view).toEqual({ kind: 'plugins', tab: 'builtin' });
  });

  it('ignores setPluginsTab when not in plugins view', () => {
    useTopLevelViewStore.getState().openSettings();
    useTopLevelViewStore.getState().setPluginsTab('builtin');
    expect(useTopLevelViewStore.getState().view).toEqual({ kind: 'settings' });
  });
});
