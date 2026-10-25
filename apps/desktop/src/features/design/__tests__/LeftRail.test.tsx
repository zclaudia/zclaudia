import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LeftRail } from '../layout/LeftRail';

function mount(overrides: Partial<React.ComponentProps<typeof LeftRail>> = {}) {
  const props: React.ComponentProps<typeof LeftRail> = {
    tier: 'medium',
    open: true,
    tab: 'pages',
    width: 240,
    deckAvailable: false,
    onSelectTab: vi.fn(),
    onToggle: vi.fn(),
    onResize: vi.fn(),
    pages: <div data-testid="pages-view" />,
    layers: <div data-testid="layers-view" />,
    library: <div data-testid="library-view" />,
    slides: <div data-testid="slides-view" />,
    ...overrides,
  };
  render(<LeftRail {...props} />);
  return props;
}

describe('LeftRail（P4 左栏面板显隐）', () => {
  it('medium 关闭时面板必须是 hidden 类且不再带 flex（jsdom 不加载 Tailwind）', () => {
    mount({ tier: 'medium', open: false });
    const panel = screen.getByTestId('design-rail-panel');
    expect(panel).toHaveClass('hidden');
    expect(panel).not.toHaveClass('flex');
    expect(screen.getByTestId('design-rail')).toHaveAttribute('data-open', 'false');
  });

  it('medium 打开时面板可见，图标条始终在流内', () => {
    mount({ tier: 'medium', open: true });
    expect(screen.getByText('Pages')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Pages panel' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Layers panel' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Library panel' })).toBeVisible();
  });

  it('narrow 关闭时整栏带 hidden 类（抽屉不占位）', () => {
    mount({ tier: 'narrow', open: false });
    expect(screen.getByTestId('design-rail')).toHaveClass('hidden');
  });

  it('narrow 打开时抽屉可见并展示关闭按钮', () => {
    mount({ tier: 'narrow', open: true });
    const rail = screen.getByTestId('design-rail');
    expect(rail).not.toHaveClass('hidden');
    expect(rail).toHaveClass('flex');
    expect(screen.getByRole('button', { name: 'Collapse panel' })).toBeVisible();
  });

  it('宽档拖拽分隔条时捕获指针，位移进入预览区仍按起点改宽', () => {
    const props = mount({ tier: 'wide', open: true, width: 240 });
    const handle = screen.getByRole('separator', { name: 'Resize panel' });
    handle.setPointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 300 });
    expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 360 });
    expect(props.onResize).toHaveBeenCalledWith(300);
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 360 });
    expect(document.body.style.cursor).toBe('');
  });

  it('deck 可用时多一个 Slides 入口', () => {
    mount({ deckAvailable: true });
    expect(screen.getByRole('button', { name: 'Slides panel' })).toBeInTheDocument();
  });
});
