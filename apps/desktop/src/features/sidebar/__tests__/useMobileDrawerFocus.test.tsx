import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMobileDrawerFocus } from '../useMobileDrawerFocus';

function Drawer({ open = true, paused = false, close = () => {} }: { open?: boolean; paused?: boolean; close?: () => void }) {
  const { panelRef, handleDrawerKeyDown } = useMobileDrawerFocus({ isMobile: true, isOpen: open, paused, onClose: close });
  return <div ref={panelRef} role="dialog" tabIndex={-1} onKeyDown={handleDrawerKeyDown}>
    <button>First</button><button hidden>Hidden</button><button disabled>Disabled</button><button>Last</button>
  </div>;
}
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function(this: HTMLElement) {
    return (this.hidden ? [] : [{}]) as unknown as DOMRectList;
  });
});
describe('drawer modal focus lifetime', () => {
  it('traps from the shell and skips hidden/disabled controls', () => {
    render(<Drawer />);
    const panel = screen.getByRole('dialog');
    expect(document.activeElement).toBe(panel);
    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('Last'));
    fireEvent.keyDown(panel, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('First'));
    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('Last'));
  });
  it('keeps background inert and scroll locked until modal lifetime ends, then restores focus', () => {
    const background = document.createElement('main');
    background.dataset.mobileDrawerBackground = '';
    const trigger = document.createElement('button');
    background.append(trigger);
    document.body.append(background);
    trigger.focus();
    const view = render(<Drawer />);
    expect(background.inert).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    view.rerender(<Drawer open={false} />);
    expect(background.inert).toBeFalsy();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
    background.remove();
  });
  it('preserves a menu trigger already focused inside the drawer when resuming', () => {
    const view = render(<Drawer />);
    view.rerender(<Drawer paused />);
    screen.getByText('First').focus();
    view.rerender(<Drawer />);
    expect(document.activeElement).toBe(screen.getByText('First'));
  });
  it('does not steal focus back from an upper modal when closing completes', () => {
    const view = render(<Drawer />);
    const upper = document.createElement('input');
    document.body.append(upper);
    view.rerender(<Drawer paused />);
    upper.focus();
    view.rerender(<Drawer open={false} paused />);
    expect(document.activeElement).toBe(upper);
    upper.remove();
  });
  it('pauses Escape and focus trapping under an upper dialog and resumes afterward', () => {
    const close = vi.fn();
    const view = render(<Drawer close={close} paused />);
    const panel = screen.getByRole('dialog');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
    view.rerender(<Drawer close={close} />);
    expect(document.activeElement).toBe(panel);
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});
