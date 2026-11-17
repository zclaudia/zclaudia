import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionActionsMenu } from '../SessionActionsMenu';

function MenuHarness({
  onExport = vi.fn(),
  isMobile = false,
  archiveDisabled = false,
  isLoading = false,
}) {
  const [open, setOpen] = useState(false);
  return (
    <SessionActionsMenu
      open={open}
      onOpenChange={setOpen}
      isMobile={isMobile}
      isLoading={isLoading}
      archiveDisabled={archiveDisabled}
      canPopOut={false}
      onInfo={vi.fn()}
      onSettings={vi.fn()}
      onReset={vi.fn()}
      onExport={onExport}
      onArchive={vi.fn()}
      onPopOut={vi.fn()}
    />
  );
}

describe('SessionActionsMenu', () => {
  it('opens by keyboard, skips disabled items and returns focus on Escape', () => {
    render(<MenuHarness isLoading archiveDisabled />);
    const trigger = screen.getByRole('button', { name: 'Session actions' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    expect(screen.getByRole('menuitem', { name: 'Session settings' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Export as Markdown' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Session settings' })).toHaveFocus();
    expect(screen.getByRole('menuitem', { name: 'Archive session' })).toHaveAccessibleDescription(
      '请先停止运行，再归档此会话。'
    );
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('executes export once and closes the controlled menu', () => {
    const onExport = vi.fn();
    render(<MenuHarness onExport={onExport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export as Markdown' }));
    expect(onExport).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('provides the same menu semantics and touch tier on mobile', () => {
    render(<MenuHarness isMobile />);
    const trigger = screen.getByRole('button', { name: 'Session actions' });
    expect(trigger).toHaveClass('max-md:h-11', 'max-md:w-11');
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Session info' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Session info' })).toHaveClass('max-md:min-h-11');
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
