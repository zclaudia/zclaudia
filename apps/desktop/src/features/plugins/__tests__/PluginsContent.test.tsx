import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginsContent } from '../PluginsContent';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';

vi.mock('../PluginsBrowseView', () => ({
  PluginsBrowseView: ({ title, onAddDirectory }: { title: string; onAddDirectory?: () => void }) => (
    <button data-testid="browse" data-title={title} onClick={onAddDirectory}>
      browse
    </button>
  ),
}));
vi.mock('../../settings/WebSearchSettings', () => ({
  WebSearchSettings: () => <div data-testid="web-search" />,
}));
vi.mock('../PluginDirsManager', () => ({
  PluginDirsManager: () => <div data-testid="dirs" />,
}));

describe('PluginsContent', () => {
  beforeEach(() => {
    useTopLevelViewStore.setState({ view: { kind: 'plugins', tab: 'plugins' } });
  });

  it('renders the Plugins browse view on the plugins tab', () => {
    render(<PluginsContent />);
    expect(screen.getByTestId('browse')).toHaveAttribute('data-title', 'Plugins');
  });

  it('renders the Built-in browse view on the built-in tab', () => {
    useTopLevelViewStore.setState({ view: { kind: 'plugins', tab: 'built-in' } });
    render(<PluginsContent />);
    expect(screen.getByTestId('browse')).toHaveAttribute('data-title', 'Built-in');
    // No "Add directory" wiring on the built-in tab, so nothing opens.
    fireEvent.click(screen.getByTestId('browse'));
    expect(screen.queryByTestId('dirs')).toBeNull();
  });

  it('opens the directories modal from the Plugins tab', () => {
    render(<PluginsContent />);
    fireEvent.click(screen.getByTestId('browse'));
    expect(screen.getByTestId('dirs')).toBeTruthy();
  });

  it('renders WebSearchSettings on the web-search tab', () => {
    useTopLevelViewStore.setState({ view: { kind: 'plugins', tab: 'web-search' } });
    render(<PluginsContent />);
    expect(screen.getByTestId('web-search')).toBeTruthy();
  });
});
