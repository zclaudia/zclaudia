import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PageTabs } from '../layout/PageTabs';
import type { PageTabsProps } from '../layout/PageTabs';
import type { DesignPageSnapshot } from '../workspace/controller';

const page = (overrides: Partial<DesignPageSnapshot> = {}): DesignPageSnapshot => ({
  path: 'design/index.html',
  status: 'clean',
  source: '<html></html>',
  draftRevision: 'r1',
  docRevision: 'r1',
  selection: null,
  externalChange: false,
  missing: false,
  busy: false,
  canUndo: false,
  canRedo: false,
  error: '',
  ...overrides,
});

function mount(overrides: Partial<PageTabsProps> = {}) {
  const props: PageTabsProps = {
    pages: [
      page({ path: 'design/index.html' }),
      page({ path: 'pages/about.html', status: 'dirty' }),
    ],
    activePath: 'design/index.html',
    files: ['design/index.html', 'pages/about.html', 'pages/new.html'],
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  };
  render(<PageTabs {...props} />);
  return {
    onActivate: props.onActivate as ReturnType<typeof vi.fn>,
    onClose: props.onClose as ReturnType<typeof vi.fn>,
    onOpen: props.onOpen as ReturnType<typeof vi.fn>,
  };
}

describe('PageTabs（P1 顶栏页签）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('每个打开页一个标签：basename + 全路径 title + aria-selected', () => {
    mount();
    const tab = screen.getByRole('tab', { name: /index\.html/ });
    expect(tab).toHaveAttribute('title', 'design/index.html');
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /about\.html/ })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('脏点与 Missing 标记（TONE_DOT + lucide TriangleAlert）', () => {
    mount({
      pages: [page({ path: 'design/index.html', status: 'dirty', missing: true })],
      activePath: 'design/index.html',
      files: ['design/index.html'],
    });
    expect(screen.getByTestId('dirty-dot-design/index.html')).toBeInTheDocument();
    expect(screen.getByLabelText('Missing file design/index.html')).toBeInTheDocument();
  });

  it('点击激活、× 走关闭请求', () => {
    const h = mount();
    fireEvent.click(screen.getByRole('tab', { name: /about\.html/ }));
    expect(h.onActivate).toHaveBeenCalledWith('pages/about.html');
    fireEvent.click(screen.getByRole('button', { name: 'Close design/index.html' }));
    expect(h.onClose).toHaveBeenCalledWith('design/index.html');
  });

  it('`+` 菜单只列未打开文件，点击即打开', async () => {
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open page' }));
    expect(screen.queryByRole('menuitem', { name: 'design/index.html' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'pages/about.html' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'pages/new.html' }));
    await waitFor(() => expect(h.onOpen).toHaveBeenCalledWith('pages/new.html'));
  });

  it('全部文件已打开时 `+` 禁用', () => {
    mount({ files: ['design/index.html', 'pages/about.html'] });
    expect(screen.getByRole('button', { name: 'Open page' })).toBeDisabled();
  });

  it('窄档只显示当前页签（showOnlyActive）', () => {
    mount({ showOnlyActive: true });
    expect(screen.getByRole('tab', { name: /index\.html/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /about\.html/ })).not.toBeInTheDocument();
  });
});
