// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SidebarNav } from '../SidebarNav';

describe('SidebarNav', () => {
  it('renders the Home item', () => {
    render(<SidebarNav onHome={vi.fn()} isHomeActive={false} />);
    expect(screen.getByRole('button', { name: 'Home' })).toBeDefined();
  });

  it('calls onHome when Home is clicked', () => {
    const onHome = vi.fn();
    render(<SidebarNav onHome={onHome} isHomeActive={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('marks Home active when isHomeActive is true', () => {
    render(<SidebarNav onHome={vi.fn()} isHomeActive={true} />);
    expect(screen.getByRole('button', { name: 'Home' }).className).not.toContain('text-muted-foreground');
  });

  it('does not mark Home active when isHomeActive is false', () => {
    render(<SidebarNav onHome={vi.fn()} isHomeActive={false} />);
    expect(screen.getByRole('button', { name: 'Home' }).className).toContain('text-muted-foreground');
  });

  it('renders Automations and fires its callback when provided', () => {
    const onOpenAutomations = vi.fn();
    render(<SidebarNav onHome={vi.fn()} isHomeActive={false} onOpenAutomations={onOpenAutomations} />);
    const automations = screen.getByRole('button', { name: 'Automations' });
    fireEvent.click(automations);
    expect(onOpenAutomations).toHaveBeenCalledTimes(1);
  });

  it('hides Automations when no callback is provided', () => {
    render(<SidebarNav onHome={vi.fn()} isHomeActive={false} />);
    expect(screen.queryByRole('button', { name: 'Automations' })).toBeNull();
  });

  const automationMode = {
    tab: 'automations' as const,
    onSelectTab: vi.fn(),
    onBack: vi.fn(),
  };

  it('renders the automation nav when automationMode is provided', () => {
    render(<SidebarNav onHome={vi.fn()} isHomeActive={false} automationMode={automationMode} />);
    expect(screen.getByRole('button', { name: 'Back to app' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Workflows' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Runs' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'System' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull();
  });

  it('fires onBack and onSelectTab from the automation nav', () => {
    const onBack = vi.fn();
    const onSelectTab = vi.fn();
    render(
      <SidebarNav
        onHome={vi.fn()}
        isHomeActive={false}
        automationMode={{ tab: 'automations', onBack, onSelectTab }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }));
    expect(onSelectTab).toHaveBeenCalledWith('runs');
  });

  it('marks the active automation tab', () => {
    render(
      <SidebarNav
        onHome={vi.fn()}
        isHomeActive={false}
        automationMode={{ tab: 'workflows', onBack: vi.fn(), onSelectTab: vi.fn() }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Workflows' }).className).not.toContain('text-muted-foreground');
    expect(screen.getByRole('button', { name: 'Runs' }).className).toContain('text-muted-foreground');
  });
});

const base = { onHome: () => {}, isHomeActive: false };

describe('SidebarNav automation mode', () => {
  it('renders four text tab rows with visible labels', () => {
    render(<SidebarNav {...base} automationMode={{ tab: 'workflows', onSelectTab: () => {}, onBack: () => {} }} />);
    for (const name of ['Automations', 'Workflows', 'Runs', 'System']) {
      expect(screen.getByRole('button', { name })).toHaveTextContent(name);
    }
  });

  it('calls onSelectTab when a row is clicked', () => {
    const onSelectTab = vi.fn();
    render(<SidebarNav {...base} automationMode={{ tab: 'workflows', onSelectTab, onBack: () => {} }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }));
    expect(onSelectTab).toHaveBeenCalledWith('runs');
  });
});
