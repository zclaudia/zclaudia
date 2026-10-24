import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TemplateDialog } from '../components/TemplateDialog';
import type { TemplateDialogProps } from '../components/TemplateDialog';
import { DesignHttpError, installDesignTemplate, listDesignTemplates } from '../api';

vi.mock('../api', () => {
  class DesignHttpError extends Error {
    constructor(
      message: string,
      readonly code: string | undefined,
      readonly files: string[] = []
    ) {
      super(message);
      this.name = 'DesignHttpError';
    }
  }
  return {
    DesignHttpError,
    installDesignTemplate: vi.fn(),
    listDesignTemplates: vi.fn(),
    // 与实现一致：按类实例判别，让 TEMPLATE_TARGET_EXISTS 分流可测。
    isDesignHttpError: (error: unknown): error is DesignHttpError =>
      error instanceof DesignHttpError,
  };
});

const TEMPLATES = [
  {
    id: 'landing',
    name: 'Landing page',
    description: 'A single-page marketing landing page with a hero section, feature grid, testimonials, and a call to action.',
    entry: 'design/landing/index.html',
    files: ['design/landing/index.html', 'design/landing/styles.css'],
    version: '1.0.0',
    source: 'zclaudia-builtin',
  },
  {
    id: 'dashboard',
    name: 'Dashboard',
    description: 'An admin dashboard with sidebar navigation, a metric card grid, and pure-CSS bar charts.',
    entry: 'design/dashboard/index.html',
    files: ['design/dashboard/index.html', 'design/dashboard/styles.css'],
    version: '1.0.0',
    source: 'zclaudia-builtin',
  },
];

function mount(overrides: Partial<TemplateDialogProps> = {}) {
  const props: TemplateDialogProps = {
    open: true,
    backendId: 'remote-1',
    sessionId: 's1',
    onClose: vi.fn(),
    onInstalled: vi.fn(),
    ...overrides,
  };
  render(<TemplateDialog {...props} />);
  return {
    onClose: props.onClose as ReturnType<typeof vi.fn>,
    onInstalled: props.onInstalled as ReturnType<typeof vi.fn>,
  };
}

describe('TemplateDialog（P4 §2.4）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listDesignTemplates).mockResolvedValue({ templates: TEMPLATES });
    vi.mocked(installDesignTemplate).mockResolvedValue({
      installed: [
        ...TEMPLATES[0].files,
        'design/landing/TEMPLATE.json',
      ],
      entry: 'design/landing/index.html',
    });
  });

  it('打开时拉取目录；列表项显示名称/描述/入口/文件数，加载中显示状态文案', async () => {
    let resolveList!: (value: { templates: typeof TEMPLATES }) => void;
    vi.mocked(listDesignTemplates).mockImplementation(
      () => new Promise(resolve => (resolveList = resolve))
    );
    mount();
    expect(screen.getByRole('status')).toHaveTextContent('Loading templates…');
    await act(async () => {
      resolveList({ templates: TEMPLATES });
    });
    const dialog = screen.getByRole('dialog', { name: 'Templates' });
    expect(dialog).toHaveTextContent('Landing page');
    expect(dialog).toHaveTextContent(
      'A single-page marketing landing page with a hero section, feature grid, testimonials, and a call to action.'
    );
    expect(dialog).toHaveTextContent('design/landing/index.html');
    expect(dialog).toHaveTextContent('2 files');
    expect(dialog).toHaveTextContent('Dashboard');
    expect(listDesignTemplates).toHaveBeenCalledWith('remote-1');
  });

  it('目录为空时显示空态', async () => {
    vi.mocked(listDesignTemplates).mockResolvedValue({ templates: [] });
    mount();
    expect(await screen.findByText('No built-in templates.')).toBeInTheDocument();
  });

  it('目录加载失败显示 message 并可重试', async () => {
    vi.mocked(listDesignTemplates).mockRejectedValueOnce(new Error('网络中断'));
    vi.mocked(listDesignTemplates).mockResolvedValue({ templates: TEMPLATES });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Landing page')).toBeInTheDocument();
    expect(listDesignTemplates).toHaveBeenCalledTimes(2);
  });

  it('安装成功：列出全部已写入文件与入口，「打开页面」上抛 entry', async () => {
    const { onInstalled, onClose } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Install Landing page' }));
    await waitFor(() =>
      expect(installDesignTemplate).toHaveBeenCalledWith('remote-1', {
        sessionId: 's1',
        templateId: 'landing',
      })
    );
    expect(await screen.findByText('Installation finished; the following files were written:')).toBeInTheDocument();
    const installed = screen.getByTestId('installed-files');
    expect(installed).toHaveTextContent('design/landing/index.html');
    expect(installed).toHaveTextContent('design/landing/styles.css');
    expect(installed).toHaveTextContent('design/landing/TEMPLATE.json');
    expect(screen.getByText(/Entry:/)).toHaveTextContent('design/landing/index.html');
    // 成功态替换列表视图，仅显示结果与「打开页面」/「关闭」
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open page' })).toBeInTheDocument();
    expect(onInstalled).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open page' }));
    expect(onInstalled).toHaveBeenCalledTimes(1);
    expect(onInstalled).toHaveBeenCalledWith('design/landing/index.html');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('409 TEMPLATE_TARGET_EXISTS：列出冲突路径，确认后带 overwrite 重试', async () => {
    vi.mocked(installDesignTemplate)
      .mockRejectedValueOnce(
        new DesignHttpError('目标文件已存在', 'TEMPLATE_TARGET_EXISTS', [
          'design/landing/index.html',
          'design/landing/styles.css',
        ])
      )
      .mockResolvedValue({
        installed: [...TEMPLATES[0].files, 'design/landing/TEMPLATE.json'],
        entry: 'design/landing/index.html',
      });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Install Landing page' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('These files already exist:');
    expect(alert).toHaveTextContent('design/landing/index.html');
    expect(alert).toHaveTextContent('design/landing/styles.css');
    expect(screen.getByText('Reinstalling will replace the files above.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reinstall and overwrite the files above' }));
    await waitFor(() => expect(installDesignTemplate).toHaveBeenCalledTimes(2));
    expect(installDesignTemplate).toHaveBeenLastCalledWith('remote-1', {
      sessionId: 's1',
      templateId: 'landing',
      overwrite: true,
    });
    expect(await screen.findByText('Installation finished; the following files were written:')).toBeInTheDocument();
  });

  it('其余安装错误显示 message，「重试」重发同一模板安装', async () => {
    vi.mocked(installDesignTemplate)
      .mockRejectedValueOnce(new Error('会话不存在'))
      .mockResolvedValue({ installed: ['design/landing/index.html'], entry: 'design/landing/index.html' });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Install Landing page' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('会话不存在');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(installDesignTemplate).toHaveBeenCalledTimes(2));
    expect(installDesignTemplate).toHaveBeenLastCalledWith('remote-1', {
      sessionId: 's1',
      templateId: 'landing',
    });
    expect(await screen.findByText('Installation finished; the following files were written:')).toBeInTheDocument();
  });

  it('安装中禁用安装按钮并显示「安装中…」', async () => {
    let resolveInstall!: (value: { installed: string[]; entry: string }) => void;
    vi.mocked(installDesignTemplate).mockImplementation(
      () => new Promise(resolve => (resolveInstall = resolve))
    );
    mount();
    const button = await screen.findByRole('button', { name: 'Install Landing page' });
    fireEvent.click(button);
    const installing = screen.getByRole('button', { name: 'Install Landing page' });
    expect(installing).toHaveTextContent('Installing…');
    expect(screen.getByRole('button', { name: 'Install Dashboard' })).toBeDisabled();
    await act(async () => {
      resolveInstall({ installed: ['design/landing/index.html'], entry: 'design/landing/index.html' });
    });
    expect(await screen.findByText('Installation finished; the following files were written:')).toBeInTheDocument();
  });

  it('open false→true 重新拉取目录', async () => {
    const props: TemplateDialogProps = {
      open: true,
      backendId: 'remote-1',
      sessionId: 's1',
      onClose: vi.fn(),
      onInstalled: vi.fn(),
    };
    const view = render(<TemplateDialog {...props} />);
    await screen.findByText('Landing page');
    view.rerender(<TemplateDialog {...props} open={false} />);
    view.rerender(<TemplateDialog {...props} open={true} />);
    await waitFor(() => expect(listDesignTemplates).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Landing page')).toBeInTheDocument();
  });
});
