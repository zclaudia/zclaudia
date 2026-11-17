import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartupConnectionState } from '../StartupConnectionState';

afterEach(() => vi.useRealTimers());

describe('StartupConnectionState', () => {
  it('explains a long connection attempt and offers reload', () => {
    vi.useFakeTimers();
    const retry = vi.fn();
    render(<StartupConnectionState message="Connecting..." error={false} onRetry={retry} />);
    expect(screen.getByRole('status')).toHaveTextContent('正在准备工作区');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole('status')).toHaveTextContent('连接仍在进行');
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('offers recovery immediately for a failed connection', () => {
    render(<StartupConnectionState message="Server failed to start" error onRetry={vi.fn()} />);
    expect(screen.getByRole('heading', { name: '连接未能建立' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
  });
});
