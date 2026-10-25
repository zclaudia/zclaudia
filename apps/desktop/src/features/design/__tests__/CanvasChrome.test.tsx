import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CanvasBanner } from '../layout/CanvasBanner';
import type { CanvasBannerItem } from '../layout/CanvasBanner';
import { CanvasEmptyState } from '../layout/CanvasEmptyState';

describe('CanvasBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('空列表渲染 null', () => {
    const { container } = render(<CanvasBanner items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('warning 项默认 role=status 且用 text-warning 配色', () => {
    const items: CanvasBannerItem[] = [{ id: 'w1', tone: 'warning', text: 'Entry file missing' }];
    render(<CanvasBanner items={items} />);
    const row = screen.getByRole('status');
    expect(row).toHaveTextContent('Entry file missing');
    expect(row).toHaveClass('text-warning');
    expect(row).toHaveClass('border-b', 'border-border');
  });

  it('destructive 项默认 role=alert 且用 text-destructive 配色', () => {
    const items: CanvasBannerItem[] = [{ id: 'd1', tone: 'destructive', text: 'Render failed' }];
    render(<CanvasBanner items={items} />);
    const row = screen.getByRole('alert');
    expect(row).toHaveTextContent('Render failed');
    expect(row).toHaveClass('text-destructive');
  });

  it('显式 role 覆盖默认值，多行按序渲染', () => {
    const items: CanvasBannerItem[] = [
      { id: 'a', tone: 'destructive', text: 'First', role: 'status' },
      { id: 'b', tone: 'warning', text: 'Second', role: 'alert' },
    ];
    const { container } = render(<CanvasBanner items={items} />);
    expect(screen.queryByRole('alert')).toHaveTextContent('Second');
    expect(screen.queryByRole('status')).toHaveTextContent('First');
    expect(container.firstElementChild?.nextElementSibling).toHaveTextContent('Second');
  });
});

describe('CanvasEmptyState', () => {
  it('两个入口按钮分别回调 onGenerate / onTemplate', () => {
    const onGenerate = vi.fn();
    const onTemplate = vi.fn();
    render(<CanvasEmptyState onGenerate={onGenerate} onTemplate={onTemplate} />);

    expect(screen.getByText('Describe a page and let the Agent build it')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ask Agent to build a page' }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onTemplate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Start from template' }));
    expect(onTemplate).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('两个按钮都是 outline 描边样式（不用实心主按钮）', () => {
    render(<CanvasEmptyState onGenerate={vi.fn()} onTemplate={vi.fn()} />);
    for (const name of ['Ask Agent to build a page', 'Start from template']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass('border', 'border-border');
      expect(button).not.toHaveClass('bg-primary');
    }
  });
});
