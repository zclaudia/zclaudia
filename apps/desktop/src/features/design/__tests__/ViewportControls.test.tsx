import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ViewportControls } from '../components/ViewportControls';
import type { ViewportControlsProps } from '../components/ViewportControls';

function mount(overrides: Partial<ViewportControlsProps> = {}) {
  const props: ViewportControlsProps = {
    viewport: { preset: 'mobile', width: 390 },
    zoom: { mode: 'fit', value: 1 },
    onViewportChange: vi.fn(),
    onZoomChange: vi.fn(),
    ...overrides,
  };
  const view = render(<ViewportControls {...props} />);
  return {
    unmount: view.unmount,
    onViewportChange: props.onViewportChange as ReturnType<typeof vi.fn>,
    onZoomChange: props.onZoomChange as ReturnType<typeof vi.fn>,
  };
}

describe('ViewportControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('switches device presets with their fixed widths', () => {
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: '视口预设' }));
    fireEvent.click(screen.getByRole('option', { name: '桌面 1280' }));
    expect(h.onViewportChange).toHaveBeenCalledWith({ preset: 'desktop', width: 1280 });
    fireEvent.click(screen.getByRole('button', { name: '视口预设' }));
    fireEvent.click(screen.getByRole('option', { name: '充满' }));
    expect(h.onViewportChange).toHaveBeenCalledWith({ preset: 'fill', width: null });
  });

  it('commits an in-range custom width and reverts invalid input without emitting', () => {
    const h = mount({ viewport: { preset: 'custom', width: 800 } });
    const input = screen.getByLabelText('自定义宽度');
    expect(input).toHaveValue('800');
    fireEvent.change(input, { target: { value: '1024' } });
    fireEvent.blur(input);
    expect(h.onViewportChange).toHaveBeenCalledWith({ preset: 'custom', width: 1024 });

    fireEvent.change(input, { target: { value: 'not-a-width' } });
    fireEvent.blur(input);
    expect(h.onViewportChange).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue('800');

    fireEvent.change(input, { target: { value: '200' } });
    fireEvent.blur(input);
    expect(h.onViewportChange).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: '4000' } });
    fireEvent.blur(input);
    expect(h.onViewportChange).toHaveBeenCalledTimes(1);
  });

  it('steps zoom by 10% in manual mode and clamps to 25%–200%', () => {
    const h = mount({ zoom: { mode: 'manual', value: 1 } });
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(h.onZoomChange).toHaveBeenLastCalledWith({ mode: 'manual', value: 1.1 });
    fireEvent.click(screen.getByRole('button', { name: '缩小' }));
    expect(h.onZoomChange).toHaveBeenLastCalledWith({ mode: 'manual', value: 0.9 });
    h.unmount();

    const hMin = mount({ zoom: { mode: 'manual', value: 0.25 } });
    expect(screen.getByRole('button', { name: '缩小' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(hMin.onZoomChange).toHaveBeenLastCalledWith({ mode: 'manual', value: 0.35 });
    hMin.unmount();

    const hMax = mount({ zoom: { mode: 'manual', value: 2 } });
    expect(screen.getByRole('button', { name: '放大' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '缩小' }));
    expect(hMax.onZoomChange).toHaveBeenLastCalledWith({ mode: 'manual', value: 1.9 });
  });

  it('resets to 100% on percentage double-click and toggles 适应 between fit and manual', () => {
    const h = mount({ zoom: { mode: 'manual', value: 1.5 } });
    expect(screen.getByText('150%')).toBeInTheDocument();
    fireEvent.doubleClick(screen.getByText('150%'));
    expect(h.onZoomChange).toHaveBeenLastCalledWith({ mode: 'manual', value: 1 });

    expect(screen.getByRole('button', { name: '适应宽度' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    fireEvent.click(screen.getByRole('button', { name: '适应宽度' }));
    expect(h.onZoomChange).toHaveBeenLastCalledWith({ mode: 'fit', value: 1.5 });
    h.unmount();

    const hFit = mount({ zoom: { mode: 'fit', value: 1.5 } });
    expect(screen.getByRole('button', { name: '适应宽度' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: '适应宽度' }));
    expect(hFit.onZoomChange).toHaveBeenLastCalledWith({ mode: 'manual', value: 1.5 });
  });

  it('disables every zoom control in the fill preset', () => {
    mount({ viewport: { preset: 'fill', width: null }, zoom: { mode: 'manual', value: 1 } });
    expect(screen.getByRole('button', { name: '缩小' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '放大' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '适应宽度' })).toBeDisabled();
    expect(screen.queryByLabelText('自定义宽度')).not.toBeInTheDocument();
  });
});
