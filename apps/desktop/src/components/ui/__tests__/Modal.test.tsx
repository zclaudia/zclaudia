import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../Modal';

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={vi.fn()} ariaLabel="Test">
        <p>Body</p>
      </Modal>
    );
    expect(screen.queryByText('Body')).toBeNull();
  });

  it('renders children when open', () => {
    render(
      <Modal open onClose={vi.fn()} ariaLabel="Test">
        <p>Body</p>
      </Modal>
    );
    expect(screen.getByText('Body')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Test' })).toBeTruthy();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} ariaLabel="Test">
        <p>Body</p>
      </Modal>
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop click', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} ariaLabel="Test">
        <p>Body</p>
      </Modal>
    );
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders a title with a close button that closes', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} ariaLabel="Test" title="Hello">
        <p>Body</p>
      </Modal>
    );
    expect(screen.getByText('Hello')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders footer content', () => {
    render(
      <Modal open onClose={vi.fn()} ariaLabel="Test" footer={<button>Go</button>}>
        <p>Body</p>
      </Modal>
    );
    expect(screen.getByRole('button', { name: 'Go' })).toBeTruthy();
  });

  it('can render a short form without a scrollable body', () => {
    render(
      <Modal open onClose={vi.fn()} ariaLabel="Test" bodyScrollable={false}>
        <p>Body</p>
      </Modal>
    );

    expect(screen.getByTestId('modal-body')).not.toHaveClass('overflow-y-auto');
  });

  it('expands to a full-screen sheet with safe-area padding on mobile', () => {
    render(
      <Modal open onClose={vi.fn()} ariaLabel="Test" mobileFullscreen isMobile>
        <p>Body</p>
      </Modal>
    );

    const dialog = screen.getByRole('dialog', { name: 'Test' });
    expect(dialog).toHaveClass('inset-0', 'rounded-none', 'safe-top-pad', 'safe-bottom-pad');
    expect(dialog).not.toHaveClass('max-w-md');
  });

  it('keeps the floating card when mobileFullscreen is set but the viewport is not mobile', () => {
    render(
      <Modal open onClose={vi.fn()} ariaLabel="Test" mobileFullscreen>
        <p>Body</p>
      </Modal>
    );

    const dialog = screen.getByRole('dialog', { name: 'Test' });
    expect(dialog).toHaveClass('max-w-md', 'rounded-2xl');
    expect(dialog).not.toHaveClass('safe-top-pad');
  });
});
