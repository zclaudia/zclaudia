import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PageTabs } from '../components/PageTabs';
import type { PageTabsProps } from '../components/PageTabs';
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
    onOpen: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
  render(<PageTabs {...props} />);
  return {
    onActivate: props.onActivate as ReturnType<typeof vi.fn>,
    onClose: props.onClose as ReturnType<typeof vi.fn>,
    onOpen: props.onOpen as ReturnType<typeof vi.fn>,
  };
}

async function pickOpenOption(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Open page' }));
  const option = await screen.findByRole('option', { name: label });
  fireEvent.click(option);
}

describe('PageTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders one tab per open page with the basename and full-path title', () => {
    mount();
    const tab = screen.getByRole('tab', { name: /index\.html/ });
    expect(tab).toHaveAttribute('title', 'design/index.html');
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /about\.html/ })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('marks dirty pages with • and missing pages with ⚠', () => {
    mount({
      pages: [
        page({ path: 'design/index.html', status: 'dirty', missing: true }),
      ],
      activePath: 'design/index.html',
      files: ['design/index.html'],
    });
    const tab = screen.getByRole('tab', { name: /index\.html/ });
    expect(tab.textContent).toContain('•');
    expect(tab.textContent).toContain('⚠');
  });

  it('activates on tab click and requests close via the × button', () => {
    const h = mount();
    fireEvent.click(screen.getByRole('tab', { name: /about\.html/ }));
    expect(h.onActivate).toHaveBeenCalledWith('pages/about.html');
    fireEvent.click(screen.getByRole('button', { name: 'Close design/index.html' }));
    expect(h.onClose).toHaveBeenCalledWith('design/index.html');
  });

  it('lists unopened files in the 打开页面 dropdown and reports success silently', async () => {
    const h = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open page' }));
    // 已打开的文件不出现在下拉里。
    expect(screen.queryByRole('option', { name: 'design/index.html' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'pages/about.html' })).not.toBeInTheDocument();
    const option = await screen.findByRole('option', { name: 'pages/new.html' });
    fireEvent.click(option);
    await waitFor(() => expect(h.onOpen).toHaveBeenCalledWith('pages/new.html'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('hints 先关闭未保存的页面 when open is rejected at the page limit', async () => {
    mount({ onOpen: vi.fn().mockResolvedValue({ ok: false, reason: 'limit' }) });
    await pickOpenOption('pages/new.html');
    expect(await screen.findByRole('status')).toHaveTextContent('Close unsaved pages first');
  });

  it('surfaces the controller message when a page fails to load', async () => {
    mount({
      onOpen: vi
        .fn()
        .mockResolvedValue({ ok: false, reason: 'load-failed', message: 'FILE_NOT_FOUND: x' }),
    });
    await pickOpenOption('pages/new.html');
    expect(await screen.findByRole('status')).toHaveTextContent('FILE_NOT_FOUND: x');
  });
});
