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
});
