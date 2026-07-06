import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginsContent } from '../PluginsContent';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';

// Stub the heavy children so the test asserts dispatch, not their internals.
vi.mock('../../settings/PluginSettings', () => ({
  PluginSettings: () => <div data-testid="plugin-settings" />,
}));
vi.mock('../BuiltinPanelsSection', () => ({
  BuiltinPanelsSection: () => <div data-testid="builtin-section" />,
}));
vi.mock('../../settings/WebSearchSettings', () => ({
  WebSearchSettings: () => <div data-testid="web-search" />,
}));
vi.mock('../BackendPicker', () => ({ BackendPicker: () => <div data-testid="backend-picker" /> }));

describe('PluginsContent', () => {
  beforeEach(() => {
    useTopLevelViewStore.setState({ view: { kind: 'plugins', tab: 'installed' } });
  });

  it('renders PluginSettings and the picker on the installed tab', () => {
    useTopLevelViewStore.setState({ view: { kind: 'plugins', tab: 'installed' } });
    render(<PluginsContent />);
    expect(screen.getByTestId('plugin-settings')).toBeTruthy();
    expect(screen.getByTestId('backend-picker')).toBeTruthy();
  });

  it('renders BuiltinPanelsSection and NO picker on the builtin tab', () => {
    useTopLevelViewStore.setState({ view: { kind: 'plugins', tab: 'builtin' } });
    render(<PluginsContent />);
    expect(screen.getByTestId('builtin-section')).toBeTruthy();
    expect(screen.queryByTestId('backend-picker')).toBeNull();
  });

  it('renders WebSearchSettings and the picker on the web-search tab', () => {
    useTopLevelViewStore.setState({ view: { kind: 'plugins', tab: 'web-search' } });
    render(<PluginsContent />);
    expect(screen.getByTestId('web-search')).toBeTruthy();
    expect(screen.getByTestId('backend-picker')).toBeTruthy();
  });
});
