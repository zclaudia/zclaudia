// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SaveStateIndicator } from './SaveStateIndicator';

describe('SaveStateIndicator', () => {
  it('shows "Saved" for the saved status', () => {
    render(<SaveStateIndicator status="saved" />);
    expect(screen.getByTestId('save-state')).toHaveTextContent('Saved');
  });

  it('shows "Saving" for the saving status', () => {
    render(<SaveStateIndicator status="saving" />);
    expect(screen.getByTestId('save-state')).toHaveTextContent(/Saving/);
  });

  it('shows "Not saved" for the pending status', () => {
    render(<SaveStateIndicator status="pending" />);
    expect(screen.getByTestId('save-state')).toHaveTextContent('Not saved');
  });

  it('shows a Retry button for the failed status and calls onRetry', () => {
    const onRetry = vi.fn();
    render(<SaveStateIndicator status="failed" onRetry={onRetry} />);
    expect(screen.getByTestId('save-state')).toHaveTextContent(/Save failed/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
