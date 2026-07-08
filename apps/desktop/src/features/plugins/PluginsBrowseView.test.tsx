import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Blocks } from 'lucide-react';
import { PluginsBrowseView } from './PluginsBrowseView';
import type { PluginCardModel } from './plugins-types';

const builtin: PluginCardModel[] = [
  { id: 'a', title: 'Terminal', pluginId: 'com.claudia.terminal', icon: Blocks, enabled: true },
  { id: 'b', title: 'Memory', pluginId: 'com.claudia.memory', icon: Blocks, enabled: true },
];

function setup(over = {}) {
  const props = {
    builtin,
    installed: [] as PluginCardModel[],
    onToggleBuiltin: vi.fn(),
    onToggleInstalled: vi.fn(),
    onAddDirectory: vi.fn(),
    ...over,
  };
  render(<PluginsBrowseView {...props} />);
  return props;
}

describe('PluginsBrowseView', () => {
  it('renders both sections with counts and the built-in empty installed state', () => {
    setup();
    expect(screen.getByText('Built-in · 2')).toBeInTheDocument();
    expect(screen.getByText('Installed · 0')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
  });

  it('filters cards across sections by query', () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText('Search plugins…'), {
      target: { value: 'memory' },
    });
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.queryByText('Terminal')).toBeNull();
    expect(screen.getByText('Built-in · 1')).toBeInTheDocument();
  });

  it('calls onAddDirectory when the button is clicked', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /add directory/i }));
    expect(props.onAddDirectory).toHaveBeenCalledTimes(1);
  });
});
