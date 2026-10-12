import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaneCard } from '../PaneCard';

describe('PaneCard', () => {
  it('uses the shared card surface and unfocused border', () => {
    render(<PaneCard data-testid="card">Content</PaneCard>);
    expect(screen.getByTestId('card')).toHaveClass(
      'bg-card',
      'rounded-lg',
      'border-border/50',
      'shadow-sm'
    );
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('applies focus chrome and forwards DOM properties and events', () => {
    const onPointerDown = vi.fn();
    render(
      <PaneCard
        focused
        className="relative"
        data-pane-id="pane-1"
        aria-label="Tool pane"
        onPointerDown={onPointerDown}
      />
    );
    const card = screen.getByLabelText('Tool pane');
    expect(card).toHaveClass('border-muted-foreground/30', 'shadow-md', 'relative');
    expect(card).not.toHaveClass('shadow-sm');
    expect(card).toHaveAttribute('data-pane-id', 'pane-1');
    fireEvent.pointerDown(card);
    expect(onPointerDown).toHaveBeenCalledOnce();
  });
});
