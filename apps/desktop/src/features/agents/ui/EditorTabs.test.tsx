// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditorTabs } from './EditorTabs';

const tabs = [
  { id: 'model', label: 'Model' },
  { id: 'capabilities', label: 'Capabilities', count: 6 },
  { id: 'prompt', label: 'Prompt' },
];

describe('EditorTabs', () => {
  it('renders a tab per item and marks the active one selected', () => {
    render(<EditorTabs tabs={tabs} active="model" onChange={vi.fn()} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: /Model/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Capabilities/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('shows a count when provided', () => {
    render(<EditorTabs tabs={tabs} active="model" onChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /Capabilities/ })).toHaveTextContent('6');
  });

  it('calls onChange with the tab id when a tab is clicked', () => {
    const onChange = vi.fn();
    render(<EditorTabs tabs={tabs} active="model" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: /Prompt/ }));
    expect(onChange).toHaveBeenCalledWith('prompt');
  });
});
