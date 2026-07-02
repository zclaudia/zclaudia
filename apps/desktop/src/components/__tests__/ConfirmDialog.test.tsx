import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ConfirmDialog } from '../ConfirmDialog';
import { confirm, promptText, useConfirmDialogStore } from '../../stores/confirmDialogStore';

describe('ConfirmDialog', () => {
  beforeEach(() => {
    useConfirmDialogStore.setState({ current: null });
  });

  it('does not render anything when idle', () => {
    const { container } = render(<ConfirmDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it('confirm() resolves true when the confirm button is clicked', async () => {
    render(<ConfirmDialog />);
    let resolved: boolean | undefined;
    act(() => {
      void confirm({ title: 'Remove worktree?', confirmLabel: 'Remove' }).then(r => {
        resolved = r;
      });
    });
    await screen.findByText('Remove worktree?');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(resolved).toBe(true));
    // Dialog closes after resolution.
    expect(screen.queryByText('Remove worktree?')).not.toBeInTheDocument();
  });

  it('confirm() resolves false when cancelled', async () => {
    render(<ConfirmDialog />);
    let resolved: boolean | undefined;
    act(() => {
      void confirm({ title: 'Drop stash?' }).then(r => {
        resolved = r;
      });
    });
    await screen.findByText('Drop stash?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(resolved).toBe(false));
  });

  it('confirm() resolves false on Escape', async () => {
    render(<ConfirmDialog />);
    let resolved: boolean | undefined;
    act(() => {
      void confirm({ title: 'Discard plan?' }).then(r => {
        resolved = r;
      });
    });
    await screen.findByText('Discard plan?');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(resolved).toBe(false));
  });

  it('promptText() resolves with the entered value', async () => {
    render(<ConfirmDialog />);
    let resolved: string | null | undefined;
    act(() => {
      void promptText({ title: 'Fork session', confirmLabel: 'Fork' }).then(r => {
        resolved = r;
      });
    });
    await screen.findByText('Fork session');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my fork' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fork' }));
    await waitFor(() => expect(resolved).toBe('my fork'));
  });

  it('promptText() resolves null when cancelled', async () => {
    render(<ConfirmDialog />);
    let resolved: string | null | undefined = 'sentinel';
    act(() => {
      void promptText({ title: 'Fork session' }).then(r => {
        resolved = r;
      });
    });
    await screen.findByText('Fork session');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(resolved).toBeNull());
  });

  it('opening a second dialog auto-cancels the first so callers never hang', async () => {
    render(<ConfirmDialog />);
    let first: boolean | undefined;
    let second: boolean | undefined;
    act(() => {
      void confirm({ title: 'First' }).then(r => {
        first = r;
      });
    });
    await screen.findByText('First');
    act(() => {
      void confirm({ title: 'Second' }).then(r => {
        second = r;
      });
    });
    // First is auto-resolved as cancelled; second dialog is now shown.
    await waitFor(() => expect(first).toBe(false));
    await screen.findByText('Second');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(second).toBe(true));
  });
});
