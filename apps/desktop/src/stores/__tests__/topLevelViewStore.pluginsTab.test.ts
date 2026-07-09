import { describe, it, expect, beforeEach } from 'vitest';
import { useTopLevelViewStore } from '../topLevelViewStore';

describe('plugins tab defaults and normalization', () => {
  beforeEach(() => {
    useTopLevelViewStore.setState({ view: { kind: 'home' } as never });
  });

  it('openPlugins defaults to the built-in tab', () => {
    useTopLevelViewStore.getState().openPlugins();
    expect(useTopLevelViewStore.getState().view).toEqual({ kind: 'plugins', tab: 'built-in' });
  });

  it('maps a legacy "installed" tab to "plugins"', () => {
    useTopLevelViewStore.getState().openPlugins('installed' as never);
    expect(useTopLevelViewStore.getState().view).toEqual({ kind: 'plugins', tab: 'plugins' });
  });

  it('maps a legacy "builtin" tab to "built-in"', () => {
    useTopLevelViewStore.getState().openPlugins('builtin' as never);
    expect(useTopLevelViewStore.getState().view).toEqual({ kind: 'plugins', tab: 'built-in' });
  });

  it('keeps built-in', () => {
    useTopLevelViewStore.getState().openPlugins('built-in');
    expect(useTopLevelViewStore.getState().view).toEqual({ kind: 'plugins', tab: 'built-in' });
  });

  it('keeps web-search', () => {
    useTopLevelViewStore.getState().openPlugins('web-search');
    expect(useTopLevelViewStore.getState().view).toEqual({ kind: 'plugins', tab: 'web-search' });
  });
});
