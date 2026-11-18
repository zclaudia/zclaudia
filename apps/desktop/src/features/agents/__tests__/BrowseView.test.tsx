import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BrowseView } from '../BrowseView';
import type { LibraryItem } from '../agents-types';

const baseProps = {
  tab: 'skills' as const,
  backendFilter: 'all',
  backends: [{ backendId: 'local', name: 'This Device', online: true }],
  items: [] as LibraryItem[],
  onOpen: vi.fn(),
  onSelectBackendFilter: vi.fn(),
  onNew: vi.fn(),
};

const skill: LibraryItem = { id: 'skill-1', kind: 'skill', backendId: 'local', title: 'My Skill' };

describe('BrowseView feedback', () => {
  it('shows loading instead of the first-use empty state', () => {
    render(<BrowseView {...baseProps} loading />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('还没有资源')).not.toBeInTheDocument();
  });

  it('distinguishes no search results and clears the query', () => {
    render(<BrowseView {...baseProps} items={[skill]} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'unmatched' },
    });
    expect(screen.getByText('没有匹配的资源')).toBeInTheDocument();
    expect(screen.queryByText('还没有资源')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }));
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveValue('');
    expect(screen.getByRole('button', { name: skill.title })).toBeInTheDocument();
  });

  it('shows the first-use empty state only after a successful load', () => {
    render(<BrowseView {...baseProps} />);
    expect(screen.getByText('还没有资源')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toHaveClass('bg-primary');
  });

  it('shows load failures and retries without claiming the catalog is empty', () => {
    const onRetry = vi.fn();
    render(
      <BrowseView {...baseProps} errors={new Map([['local', 'network error']])} onRetry={onRetry} />
    );
    expect(screen.getByText('资源加载失败')).toBeInTheDocument();
    expect(screen.queryByText('还没有资源')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps successful results visible when another backend fails', () => {
    const onRetry = vi.fn();
    render(
      <BrowseView
        {...baseProps}
        items={[skill]}
        backends={[...baseProps.backends, { backendId: 'remote', name: 'Remote', online: true }]}
        errors={new Map([['remote', 'offline']])}
        onRetry={onRetry}
      />
    );
    expect(screen.getByRole('button', { name: skill.title })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Remote');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not offer creation when the filtered backend is offline', () => {
    render(<BrowseView {...baseProps} backends={[{ ...baseProps.backends[0], online: false }]} />);
    expect(screen.getByText('Backend 暂不可用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeDisabled();
  });
});
