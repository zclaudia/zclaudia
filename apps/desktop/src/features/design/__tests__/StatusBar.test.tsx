import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StatusBar } from '../layout/StatusBar';
import type { StatusBarProps } from '../layout/StatusBar';

function mount(overrides: Partial<StatusBarProps> = {}) {
  // 同一用例内多次 mount 时先卸载上一棵树，避免重复匹配。
  cleanup();
  const props: StatusBarProps = {
    dirty: false,
    loading: false,
    busy: false,
    runMode: false,
    runBlocked: null,
    viewport: { preset: 'fill', width: null },
    zoomLabel: '64%',
    onViewDiff: vi.fn(),
    rightOpen: false,
    onToggleInspector: vi.fn(),
    ...overrides,
  };
  render(<StatusBar {...props} />);
  return {
    onViewDiff: props.onViewDiff as ReturnType<typeof vi.fn>,
    onToggleInspector: props.onToggleInspector as ReturnType<typeof vi.fn>,
  };
}

describe('StatusBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dirty 时显示带警示点的 Unsaved · View diff 按钮并回调 onViewDiff', () => {
    const h = mount({ dirty: true });
    const button = screen.getByRole('button', { name: 'Unsaved changes' });
    expect(button).toHaveTextContent('Unsaved · View diff');
    expect(button.querySelector('span.rounded-full')).toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(h.onViewDiff).toHaveBeenCalledTimes(1);
  });

  it('clean 时显示 Saved 且没有差异按钮', () => {
    mount({ dirty: false });
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unsaved changes' })).not.toBeInTheDocument();
  });

  it('loading/busy 分别显示 Loading… / Saving…，loading 优先', () => {
    mount({ loading: true });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument();

    mount({ busy: true });
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();

    mount({ loading: true, busy: true, dirty: true });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unsaved changes' })).not.toBeInTheDocument();
  });

  it('runMode 显示交互受限提示，并在 runBlocked 计数非零时显示移除数量', () => {
    mount({ runMode: true, runBlocked: { scripts: 2, links: 1 } });
    expect(screen.getByRole('status')).toHaveTextContent('Run mode: interaction only');
    expect(
      screen.getByText('Removed 2 external script(s) and 1 external link(s)')
    ).toBeInTheDocument();
  });

  it('runBlocked 为 null 或计数为零时不显示移除提示', () => {
    mount({ runMode: true, runBlocked: null });
    expect(screen.queryByText(/Removed/)).not.toBeInTheDocument();

    mount({ runMode: true, runBlocked: { scripts: 0, links: 0 } });
    expect(screen.queryByText(/Removed/)).not.toBeInTheDocument();

    mount({ runMode: false, runBlocked: { scripts: 3, links: 2 } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/Removed/)).not.toBeInTheDocument();
  });

  it('视口预设渲染对应标签，custom 带宽度', () => {
    const cases: { viewport: StatusBarProps['viewport']; label: string }[] = [
      { viewport: { preset: 'fill', width: null }, label: 'Fill' },
      { viewport: { preset: 'desktop', width: 1280 }, label: 'Desktop 1280' },
      { viewport: { preset: 'tablet', width: 768 }, label: 'Tablet 768' },
      { viewport: { preset: 'mobile', width: 390 }, label: 'Mobile 390' },
      { viewport: { preset: 'custom', width: 800 }, label: 'Custom 800px' },
      { viewport: { preset: 'custom', width: null }, label: 'Custom' },
    ];
    for (const { viewport, label } of cases) {
      mount({ viewport });
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('原样展示预格式化的缩放文案', () => {
    mount({ zoomLabel: 'Fit · 64%' });
    expect(screen.getByText('Fit · 64%')).toBeInTheDocument();
  });

  it('检查器按钮用 aria-pressed 反映开合并回调 onToggleInspector', () => {
    const h = mount({ rightOpen: false });
    const toggle = screen.getByRole('button', { name: 'Toggle inspector' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(h.onToggleInspector).toHaveBeenCalledTimes(1);

    mount({ rightOpen: true });
    expect(screen.getByRole('button', { name: 'Toggle inspector' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });
});
