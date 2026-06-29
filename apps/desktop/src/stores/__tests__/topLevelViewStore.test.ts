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
    useTopLevelViewStore.getState().openSettings('providers');
    expect(useTopLevelViewStore.getState().view).toEqual({
      kind: 'settings',
      initialTab: 'providers',
    });
  });

  it('returns to the normal app shell', () => {
    useTopLevelViewStore.getState().openSettings('agents');
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
