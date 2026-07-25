import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tooltip } from '../Tooltip';
import { IconButton } from '../Button';

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderTip(disabled = false) {
    render(
      <Tooltip content="Copy path" disabled={disabled}>
        <IconButton aria-label="Copy">c</IconButton>
      </Tooltip>
    );
    return screen.getByRole('button', { name: 'Copy' });
  }

  it('shows after the hover delay and hides on leave', () => {
    const btn = renderTip();
    fireEvent.mouseEnter(btn.parentElement!);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Copy path');
    fireEvent.mouseLeave(btn.parentElement!);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows immediately on keyboard focus and wires aria-describedby', () => {
    const btn = renderTip();
    fireEvent.focus(btn);
    const tip = screen.getByRole('tooltip');
    expect(btn.parentElement!.getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.blur(btn);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('hides on Escape', () => {
    const btn = renderTip();
    fireEvent.focus(btn);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('never shows when disabled', () => {
    const btn = renderTip(true);
    fireEvent.mouseEnter(btn.parentElement!);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
