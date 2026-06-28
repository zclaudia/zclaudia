import { describe, it, expect, beforeEach } from 'vitest';
import { useTopLevelViewStore } from '../topLevelViewStore';

describe('topLevelViewStore', () => {
  beforeEach(() => {
    useTopLevelViewStore.setState({ view: { kind: 'app' } });
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
