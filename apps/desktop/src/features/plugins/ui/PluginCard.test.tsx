import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Blocks } from 'lucide-react';
import { PluginCard } from './PluginCard';
import type { PluginCardModel } from '../plugins-types';

const model: PluginCardModel = {
  id: 'com.claudia.terminal',
  title: 'Terminal',
  pluginId: 'com.claudia.terminal',
  icon: Blocks,
  enabled: true,
};

describe('PluginCard', () => {
  it('shows title, mono id, kind badge, and Active status when enabled', () => {
    render(<PluginCard model={model} kind="Built-in" onToggle={() => {}} />);
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('com.claudia.terminal')).toBeInTheDocument();
    expect(screen.getByText('Built-in')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows Disabled when not enabled', () => {
    render(<PluginCard model={{ ...model, enabled: false }} kind="Built-in" onToggle={() => {}} />);
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('calls onToggle when the switch is clicked', () => {
    const onToggle = vi.fn();
    render(<PluginCard model={model} kind="Built-in" onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
