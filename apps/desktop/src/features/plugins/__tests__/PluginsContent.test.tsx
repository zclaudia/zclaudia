import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginsContent } from '../PluginsContent';
import { useTopLevelViewStore } from '../../../stores/topLevelViewStore';

vi.mock('../PluginsBrowseView', () => ({
  PluginsBrowseView: ({
    title,
    onAddDirectory,
    onInstallPlugin,
  }: {
    title: string;
    onAddDirectory?: () => void;
    onInstallPlugin?: () => void;
  }) => (
    <div data-testid="browse" data-title={title}>
      <button onClick={onAddDirectory}>directories</button>
      <button onClick={onInstallPlugin}>install</button>
    </div>
  ),
}));
vi.mock('../../settings/WebSearchSettings', () => ({
  WebSearchSettings: () => <div data-testid="web-search" />,
}));
vi.mock('../PluginDirsManager', () => ({
  PluginDirsManager: () => <div data-testid="dirs" />,
}));
vi.mock('../PluginInstallModal', () => ({
  PluginInstallModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="install-modal" /> : null,
}));
vi.mock('../PluginDetailModal', () => ({
  PluginDetailModal: () => null,
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
    fireEvent.click(screen.getByText('directories'));
    expect(screen.queryByTestId('dirs')).toBeNull();
  });

  it('opens the directories modal from the Plugins tab', () => {
    render(<PluginsContent />);
    fireEvent.click(screen.getByText('directories'));
    expect(screen.getByTestId('dirs')).toBeTruthy();
  });

  it('opens the package installer from the Plugins tab', () => {
    render(<PluginsContent />);
    fireEvent.click(screen.getByText('install'));
    expect(screen.getByTestId('install-modal')).toBeTruthy();
  });

  it('renders WebSearchSettings on the web-search tab', () => {
    useTopLevelViewStore.setState({ view: { kind: 'plugins', tab: 'web-search' } });
    render(<PluginsContent />);
    expect(screen.getByTestId('web-search')).toBeTruthy();
  });
});
