import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ViewportBar } from '../layout/ViewportBar';
import type { ViewportBarProps } from '../layout/ViewportBar';

function mount(overrides: Partial<ViewportBarProps> = {}) {
  const props: ViewportBarProps = {
    viewport: { preset: 'mobile', width: 390 },
    zoom: { mode: 'fit', value: 1 },
    onViewportChange: vi.fn(),
    onZoomChange: vi.fn(),
    ...overrides,
  };
  const view = render(<ViewportBar {...props} />);
  return {
    unmount: view.unmount,
    onViewportChange: props.onViewportChange as ReturnType<typeof vi.fn>,
    onZoomChange: props.onZoomChange as ReturnType<typeof vi.fn>,
  };
}

describe('ViewportBar（P1 顶栏视口/缩放）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('设备图标切换固定宽度预设，Fill 走 fill/null', () => {
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Desktop viewport' }));
    expect(h.onViewportChange).toHaveBeenCalledWith({ preset: 'desktop', width: 1280 });
    fireEvent.click(screen.getByRole('button', { name: 'Tablet viewport' }));
    expect(h.onViewportChange).toHaveBeenLastCalledWith({ preset: 'tablet', width: 768 });
    fireEvent.click(screen.getByRole('button', { name: 'Fill viewport' }));
    expect(h.onViewportChange).toHaveBeenLastCalledWith({ preset: 'fill', width: null });
  });

  it('aria-pressed 反映当前预设', () => {
    mount({ viewport: { preset: 'tablet', width: 768 } });
    expect(screen.getByRole('button', { name: 'Tablet viewport' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Desktop viewport' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('自定义宽度：合法提交 custom，非法/越界回退且不提交', () => {
    const h = mount({ viewport: { preset: 'custom', width: 800 } });
    const input = screen.getByLabelText('Custom width');
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

  it('缩放按 10% 步进并夹在 25%–200%', () => {
    const h = mount({ zoom: { mode: 'manual', value: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(h.onZoomChange).toHaveBeenLastCalledWith({ mode: 'manual', value: 1.1 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(h.onZoomChange).toHaveBeenLastCalledWith({ mode: 'manual', value: 0.9 });
    h.unmount();

    const hMin = mount({ zoom: { mode: 'manual', value: 0.25 } });
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(hMin.onZoomChange).toHaveBeenLastCalledWith({ mode: 'manual', value: 0.35 });
    hMin.unmount();

    const hMax = mount({ zoom: { mode: 'manual', value: 2 } });
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(hMax.onZoomChange).toHaveBeenLastCalledWith({ mode: 'manual', value: 1.9 });
  });

  it('百分比双击回 100%，单击切换 fit/manual；fit 显示实际缩放', () => {
    const h = mount({ zoom: { mode: 'manual', value: 1.5 } });
    expect(screen.getByText('150%')).toBeInTheDocument();
    fireEvent.doubleClick(screen.getByText('150%'));
    expect(h.onZoomChange).toHaveBeenLastCalledWith({ mode: 'manual', value: 1 });

    expect(screen.getByRole('button', { name: 'Fit width' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fit width' }));
    expect(h.onZoomChange).toHaveBeenLastCalledWith({ mode: 'fit', value: 1.5 });
    h.unmount();

    const hFit = mount({ zoom: { mode: 'fit', value: 1.5 }, actualScale: 0.64 });
    expect(screen.getByText('Fit · 64%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fit width' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fit width' }));
    expect(hFit.onZoomChange).toHaveBeenLastCalledWith({ mode: 'manual', value: 0.64 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(hFit.onZoomChange).toHaveBeenLastCalledWith({ mode: 'manual', value: 0.54 });
  });

  it('fill 预设下所有缩放控件禁用且隐藏宽度输入', () => {
    mount({ viewport: { preset: 'fill', width: null }, zoom: { mode: 'manual', value: 1 } });
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Fit width' })).toBeDisabled();
    expect(screen.queryByLabelText('Custom width')).not.toBeInTheDocument();
  });
});
