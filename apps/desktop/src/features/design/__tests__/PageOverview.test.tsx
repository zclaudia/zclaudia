import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PageOverview } from '../components/PageOverview';
import type { PageOverviewProps } from '../components/PageOverview';
import { WorkspaceToolProvider } from '../../../components/workspace/WorkspaceToolContext';
import { useFileViewerStore } from '../../../stores/fileViewerStore';
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

function mount(overrides: Partial<PageOverviewProps> = {}) {
  const props: PageOverviewProps = {
    pages: [
      page('design/index.html'),
      page('pages/about.html', { status: 'dirty', draftRevision: 'r2' }),
      page('pages/gone.html', { missing: true }),
    ],
    activePath: 'design/index.html',
    previews: { 'design/index.html': '<html><body>home</body></html>' },
    onRequestPreview: vi.fn(),
    onActivate: vi.fn(),
    ...overrides,
  };
  render(
    <WorkspaceToolProvider
      sessionId="session-1"
      projectId="project-1"
      projectRoot="/work"
      workingDirectory="/work"
      backendId="remote-1"
      toolId="design"
      visible
    >
      <PageOverview {...props} />
    </WorkspaceToolProvider>
  );
  return {
    onRequestPreview: props.onRequestPreview as ReturnType<typeof vi.fn>,
    onActivate: props.onActivate as ReturnType<typeof vi.fn>,
  };
}

describe('PageOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFileViewerStore.getState().close();
  });

  it('renders one thumbnail grid cell per open page with badges', () => {
    mount();
    expect(screen.getByTitle('页面缩略图 design/index.html')).toBeInTheDocument();
    expect(screen.getByTitle('页面缩略图 pages/about.html')).toBeInTheDocument();
    expect(screen.getByTitle('页面缩略图 pages/gone.html')).toBeInTheDocument();
    expect(screen.getByText('未保存')).toBeInTheDocument();
    expect(screen.getByText('缺失')).toBeInTheDocument();
  });

  it('requests lazy preview builds only for pages missing from the cache', () => {
    const h = mount();
    expect(h.onRequestPreview).toHaveBeenCalledTimes(2);
    const requested = h.onRequestPreview.mock.calls.map(call => call[0].path);
    expect(requested).not.toContain('design/index.html');
    expect(requested).toContain('pages/about.html');
    expect(requested).toContain('pages/gone.html');
  });

  it('activates a page when its card is clicked', () => {
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: '激活 pages/about.html' }));
    expect(h.onActivate).toHaveBeenCalledWith('pages/about.html');
  });

  it('opens the disk file in the viewer with the workspace project root', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: '在查看器中打开 pages/about.html' }));
    await waitFor(() => {
      const viewer = useFileViewerStore.getState();
      expect(viewer.isOpen).toBe(true);
      expect(viewer.projectRoot).toBe('/work');
      expect(viewer.filePath).toBe('pages/about.html');
      expect(viewer.backendId).toBe('remote-1');
    });
  });

  it('shows the empty hint when no page is open', () => {
    mount({ pages: [], previews: {} });
    expect(screen.getByText(/尚无打开的页面/)).toBeInTheDocument();
  });
});
