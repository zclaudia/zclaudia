import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Blocks } from 'lucide-react';
import { PluginsBrowseView } from './PluginsBrowseView';
import type { PluginCardModel } from './plugins-types';

const models: PluginCardModel[] = [
  { id: 'a', title: 'Terminal', pluginId: 'com.claudia.terminal', icon: Blocks, enabled: true },
  { id: 'b', title: 'Memory', pluginId: 'com.claudia.memory', icon: Blocks, enabled: true },
];

function setup(over: Partial<React.ComponentProps<typeof PluginsBrowseView>> = {}) {
  const props = {
    title: 'Built-in',
    models,
    kind: 'Built-in' as const,
    onToggle: vi.fn(),
    emptyText: 'No built-in panels.',
    searchPlaceholder: 'Search built-in…',
    ...over,
  };
  render(<PluginsBrowseView {...props} />);
  return props;
}

describe('PluginsBrowseView', () => {
  it('renders the title, count, and cards', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Built-in' })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('Memory')).toBeInTheDocument();
  });

  it('filters cards by query', () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText('Search built-in…'), {
      target: { value: 'memory' },
    });
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.queryByText('Terminal')).toBeNull();
  });

  it('shows the empty state when there are no models', () => {
    setup({ models: [], emptyText: 'No plugins installed.' });
    expect(screen.getByText('No plugins installed.')).toBeInTheDocument();
  });

  it('omits development directories when onAddDirectory is not provided', () => {
    setup();
    expect(screen.queryByRole('button', { name: /development directories/i })).toBeNull();
  });

  it('renders development directories when provided and calls it', () => {
    const onAddDirectory = vi.fn();
    setup({ onAddDirectory });
    fireEvent.click(screen.getByRole('button', { name: /development directories/i }));
    expect(onAddDirectory).toHaveBeenCalledTimes(1);
  });

  it('renders the primary package installation action', () => {
    const onInstallPlugin = vi.fn();
    setup({ onInstallPlugin });
    fireEvent.click(screen.getByRole('button', { name: /install plugin/i }));
    expect(onInstallPlugin).toHaveBeenCalledTimes(1);
  });
});
