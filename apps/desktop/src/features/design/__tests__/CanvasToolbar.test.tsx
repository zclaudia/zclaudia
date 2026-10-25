import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CanvasToolbar } from '../layout/CanvasToolbar';
import type { CanvasToolbarProps } from '../layout/CanvasToolbar';

function mount(overrides: Partial<CanvasToolbarProps> = {}) {
  const props: CanvasToolbarProps = {
    viewport: { preset: 'desktop', width: 1280 },
    zoom: { mode: 'fit', value: 1 },
    onViewportChange: vi.fn(),
    onZoomChange: vi.fn(),
    ...overrides,
  };
  render(<CanvasToolbar {...props} />);
  return {
    onViewportChange: props.onViewportChange as ReturnType<typeof vi.fn>,
    onZoomChange: props.onZoomChange as ReturnType<typeof vi.fn>,
  };
}

describe('CanvasToolbar（画布上方视口/缩放）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders one labelled toolbar around the reused viewport controls', () => {
    mount();
    expect(screen.getByTestId('design-canvas-toolbar')).toHaveAttribute('role', 'toolbar');
    expect(screen.getByRole('toolbar', { name: 'Canvas toolbar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desktop viewport' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Custom width')).toBeInTheDocument();
  });

  it('forwards viewport and zoom callbacks to the shared ViewportBar', () => {
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Tablet viewport' }));
    expect(h.onViewportChange).toHaveBeenCalledWith({ preset: 'tablet', width: 768 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(h.onZoomChange).toHaveBeenCalledWith({ mode: 'manual', value: 1.1 });
  });

  it('compact hides Custom width but keeps devices and zoom controls', () => {
    mount({ compact: true });
    expect(screen.queryByLabelText('Custom width')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desktop viewport' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mobile viewport' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fit width' })).toBeInTheDocument();
  });
});
