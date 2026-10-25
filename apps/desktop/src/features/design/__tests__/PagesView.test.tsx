import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PagesView } from '../rail/PagesView';
import type { PagesViewProps } from '../rail/PagesView';
import type { DesignPageSnapshot } from '../workspace/controller';

const page = (path: string, overrides: Partial<DesignPageSnapshot> = {}): DesignPageSnapshot => ({
  path,
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

function mount(overrides: Partial<PagesViewProps> = {}) {
  const props: PagesViewProps = {
    pages: [
      page('design/index.html'),
      page('pages/about.html', { status: 'dirty', draftRevision: 'r2' }),
      page('pages/gone.html', { missing: true }),
    ],
    activePath: 'design/index.html',
    files: ['design/index.html', 'pages/about.html', 'pages/gone.html', 'pages/fresh.html'],
    previews: {},
    overviewOpen: false,
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onOpen: vi.fn(),
    onOpenTemplates: vi.fn(),
    onToggleOverview: vi.fn(),
    onOpenInViewer: vi.fn(),
    onRequestPreview: vi.fn(),
    ...overrides,
  };
  const utils = render(<PagesView {...props} />);
  return { ...utils, props };
}

describe('PagesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('为每个已打开页渲染一行（缩略图 + basename + 行菜单）', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Activate design/index.html' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate pages/about.html' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate pages/gone.html' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Page actions design/index.html' })
    ).toBeInTheDocument();
    // 未构建预览 → 灰块，无 iframe。
    expect(screen.queryByTitle('Page thumbnail design/index.html')).not.toBeInTheDocument();
    expect(screen.getByText('index.html')).toBeInTheDocument();
  });

  it('点击行激活页面；活动行带 aria-current', () => {
    const h = mount();
    const activeRow = screen.getByRole('button', { name: 'Activate design/index.html' });
    expect(activeRow).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Activate pages/about.html' })).not.toHaveAttribute(
      'aria-current'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Activate pages/about.html' }));
    expect(h.props.onActivate).toHaveBeenCalledWith('pages/about.html');
  });

  it('从 Not open 分组打开未打开的文件；已打开文件不出现', () => {
    const h = mount();
    expect(screen.getByText('Not open')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open design/index.html' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open pages/fresh.html' }));
    expect(h.props.onOpen).toHaveBeenCalledWith('pages/fresh.html');
  });

  it('全部文件都已打开时隐藏 Not open 分组', () => {
    mount({
      files: ['design/index.html', 'pages/about.html', 'pages/gone.html'],
    });
    expect(screen.queryByText('Not open')).not.toBeInTheDocument();
  });

  it('通过 Page actions 菜单关闭页面', async () => {
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Page actions pages/about.html' }));
    expect(await screen.findByRole('menuitem', { name: 'Open in viewer' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close' }));
    expect(h.props.onClose).toHaveBeenCalledWith('pages/about.html');
  });

  it('头部开关：模板入口与 Overview', () => {
    const h = mount({ overviewOpen: true });
    const overview = screen.getByRole('button', { name: 'Overview' });
    expect(overview).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(overview);
    expect(h.props.onToggleOverview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'New page from template' }));
    expect(h.props.onOpenTemplates).toHaveBeenCalledTimes(1);
  });

  it('可见性门控：jsdom 无 IntersectionObserver 时立即可见，且每页只请求一次预览', () => {
    const h = mount();
    expect(typeof IntersectionObserver).toBe('undefined');
    expect(h.props.onRequestPreview).toHaveBeenCalledTimes(3);
    // 已请求即去重：重渲染不重复发起。
    h.rerender(<PagesView {...h.props} />);
    expect(h.props.onRequestPreview).toHaveBeenCalledTimes(3);
    // 预览到位后不再请求该页，其余页面保持去重。
    h.rerender(
      <PagesView
        {...h.props}
        previews={{ 'design/index.html': '<html><body>home</body></html>' }}
      />
    );
    expect(h.props.onRequestPreview).toHaveBeenCalledTimes(3);
    // 只有已构建的页面挂 iframe。
    expect(screen.getByTitle('Page thumbnail design/index.html')).toBeInTheDocument();
    expect(screen.queryByTitle('Page thumbnail pages/about.html')).not.toBeInTheDocument();
  });

  it('脏页显示警示点，缺失页显示 Missing 徽标', () => {
    const { container } = mount();
    expect(container.querySelector('span.bg-warning')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
  });

  it('干净且未缺失的页面不显示标记', () => {
    mount({
      pages: [page('design/index.html')],
      files: ['design/index.html'],
    });
    expect(screen.queryByText('Missing')).not.toBeInTheDocument();
    expect(screen.queryByText('bg-warning')).not.toBeInTheDocument();
    expect(document.querySelector('span.bg-warning')).not.toBeInTheDocument();
  });

  it('没有已打开页时显示空态提示', () => {
    mount({ pages: [], files: [], previews: {} });
    expect(screen.getByText('No page open yet.')).toBeInTheDocument();
  });
});
