import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useDesignNotices } from '../hooks/useDesignNotices';
import type { DesignNotice } from '../hooks/useDesignNotices';
import { NoticeStack } from '../layout/NoticeStack';

/** 测试宿主：挂 useDesignNotices + NoticeStack，把 push/dismiss 暴露给断言。 */
let host: { push: (notice: DesignNotice) => void; dismiss: (id: string) => void };

function Host() {
  const { notices, push, dismiss } = useDesignNotices();
  useEffect(() => {
    host = { push, dismiss };
  }, [push, dismiss]);
  return <NoticeStack notices={notices} onDismiss={dismiss} />;
}

function mount() {
  return render(<Host />);
}

describe('useDesignNotices + NoticeStack', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('空通知栈不渲染任何内容', () => {
    const { container } = mount();
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('渲染文本与 role=status，圆点随 tone 取语义色', () => {
    mount();
    act(() => host.push({ id: 'dirty', text: 'There are unsaved changes.', tone: 'warning' }));
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('There are unsaved changes.');
    expect(notice.querySelector('span')?.className).toContain('bg-warning');

    act(() => host.push({ id: 'plain', text: 'Default tone.' }));
    expect(notice.className).toContain('bg-popover/95');
    expect(screen.getByText('Default tone.')).toBeInTheDocument();
  });

  it('点击动作按钮回调 onSelect', () => {
    mount();
    const onSelect = vi.fn();
    act(() =>
      host.push({
        id: 'conflict',
        text: 'Changed on disk.',
        actions: [{ label: 'Reload', onSelect }],
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('点击关闭按钮回调 onDismiss(id) 并移除该条', () => {
    mount();
    act(() => host.push({ id: 'close-me', text: 'Closeable notice.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice: Closeable notice.' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('ttl 到时自动消失，无 ttl 的常驻', () => {
    vi.useFakeTimers();
    mount();
    act(() => {
      host.push({ id: 'flash', text: 'Auto dismisses.', ttl: 4000 });
      host.push({ id: 'sticky', text: 'Persistent notice.' });
    });
    expect(screen.getAllByRole('status')).toHaveLength(2);
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Persistent notice.');
  });

  it('同 id 再推入重置 ttl 且只渲染一条（内容为最新）', () => {
    vi.useFakeTimers();
    mount();
    act(() => host.push({ id: 'n', text: 'First.', ttl: 4000 }));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => host.push({ id: 'n', text: 'Second.', ttl: 4000 }));
    const rendered = screen.getAllByRole('status');
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toHaveTextContent('Second.');
    // 距首次推入已满 4000ms：旧计时若未被清掉这里就该消失。
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getAllByRole('status')).toHaveLength(1);
    // 重启后满 4000ms：按新计时消失。
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
