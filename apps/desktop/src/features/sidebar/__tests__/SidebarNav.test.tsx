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
    // Active = non-muted foreground; inactive uses text-muted-foreground.
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
});
