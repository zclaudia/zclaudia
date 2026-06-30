import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SidebarNav } from '../SidebarNav';

describe('SidebarNav automation mode', () => {
  const baseMode = {
    tab: 'workflows' as const,
    onSelectTab: vi.fn(),
    onBack: vi.fn(),
  };

  it('renders four text tab rows with visible labels', () => {
    render(
      <SidebarNav onHome={vi.fn()} isHomeActive={false} automationMode={baseMode} />,
    );
    for (const label of ['Automations', 'Workflows', 'Runs', 'System']) {
      expect(screen.getByRole('button', { name: label })).toHaveTextContent(label);
    }
  });

  it('calls onSelectTab when a row is clicked', () => {
    const onSelectTab = vi.fn();
    render(
      <SidebarNav onHome={vi.fn()} isHomeActive={false} automationMode={{ ...baseMode, onSelectTab }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }));
    expect(onSelectTab).toHaveBeenCalledWith('runs');
  });
});
