import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastContainer } from '../ToastContainer';
import { useToastStore } from '../../stores/toastStore';

describe('ToastContainer', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('renders with the default bottom-right positioning', () => {
    useToastStore.setState({
      toasts: [
        {
          id: 'toast-1',
          title: 'Saved',
          type: 'success',
          createdAt: Date.now(),
        },
      ],
    });

    render(<ToastContainer />);

    expect(screen.getByTestId('toast-container')).toHaveClass('fixed', 'bottom-4', 'right-4');
  });

  it('allows the caller to override the container position', () => {
    useToastStore.setState({
      toasts: [
        {
          id: 'toast-2',
          title: 'Updated',
          type: 'info',
          createdAt: Date.now(),
        },
      ],
    });

    render(<ToastContainer className="absolute top-4 left-1/2 -translate-x-1/2" />);

    expect(screen.getByTestId('toast-container')).toHaveClass(
      'absolute',
      'top-4',
      'left-1/2',
      '-translate-x-1/2'
    );
  });

  it('exposes the container as a labelled notifications region', () => {
    useToastStore.setState({
      toasts: [{ id: 't', title: 'Saved', type: 'success', createdAt: Date.now() }],
    });
    render(<ToastContainer />);
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeTruthy();
  });

  it('announces errors assertively (role=alert) and others politely (role=status)', () => {
    useToastStore.setState({
      toasts: [
        { id: 'e', title: 'Failed', type: 'error', createdAt: Date.now() },
        { id: 's', title: 'Saved', type: 'success', createdAt: Date.now() },
      ],
    });
    render(<ToastContainer />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('gives the dismiss control an accessible name and removes on click', () => {
    useToastStore.setState({
      toasts: [{ id: 'd', title: 'Saved', type: 'success', createdAt: Date.now() }],
    });
    render(<ToastContainer />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('renders a keyboard-reachable action button when the toast has onClick', () => {
    const onClick = vi.fn();
    useToastStore.setState({
      toasts: [{ id: 'a', title: 'View run', type: 'info', createdAt: Date.now(), onClick }],
    });
    render(<ToastContainer />);
    // Two buttons: the action (named by title) and the dismiss control.
    fireEvent.click(screen.getByRole('button', { name: /View run/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('has no action button for a plain informational toast', () => {
    useToastStore.setState({
      toasts: [{ id: 'p', title: 'Heads up', type: 'info', createdAt: Date.now() }],
    });
    render(<ToastContainer />);
    // Only the dismiss control is interactive.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeTruthy();
  });
});
