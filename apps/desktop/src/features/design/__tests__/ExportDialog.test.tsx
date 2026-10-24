import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ExportDialog } from '../components/ExportDialog';
import type { ExportDialogProps } from '../components/ExportDialog';
import { DesignHttpError, exportDesignZip } from '../api';
import { saveBlobToFile } from '../../../services/fileDownload';

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
    exportDesignZip: vi.fn(),
    // 与实现一致：按类实例判别，让 EXPORT_INCOMPLETE / REVISION_CONFLICT 分流可测。
    isDesignHttpError: (error: unknown): error is DesignHttpError =>
      error instanceof DesignHttpError,
  };
});

vi.mock('../../../services/fileDownload', () => ({
  saveBlobToFile: vi.fn(),
}));

function mount(overrides: Partial<ExportDialogProps> = {}) {
  const props: ExportDialogProps = {
    open: true,
    backendId: 'remote-1',
    sessionId: 's1',
    path: 'design/index.html',
    dirty: false,
    expectedRevision: 'rev-disk',
    draftSource: '<html><body>draft</body></html>',
    onSave: vi.fn().mockResolvedValue('rev-saved'),
    onRefresh: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<ExportDialog {...props} />);
  return {
    onClose: props.onClose,
    onSave: props.onSave,
    onRefresh: props.onRefresh,
  };
}

describe('ExportDialog（P2 §6.4）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveBlobToFile).mockResolvedValue('/Downloads/export.zip');
  });

  it('干净页打开即以 disk 模式直通导出（请求体带版本钉）并保存落盘', async () => {
    vi.mocked(exportDesignZip).mockResolvedValue({
      blob: new Blob(['zip-bytes']),
      filename: 'index-20261023.zip',
    });
    mount();
    await waitFor(() =>
      expect(exportDesignZip).toHaveBeenCalledWith('remote-1', {
        sessionId: 's1',
        path: 'design/index.html',
        mode: 'disk',
        expectedRevision: 'rev-disk',
      })
    );
    expect(saveBlobToFile).toHaveBeenCalledWith(expect.any(Blob), 'index-20261023.zip');
    expect(await screen.findByText('Exported: index-20261023.zip')).toBeInTheDocument();
  });

  it('dirty 页三选：不自动导出，取消直接关闭', () => {
    const { onClose } = mount({ dirty: true });
    const dialog = screen.getByRole('dialog', { name: 'Export' });
    expect(within(dialog).getByText(/has unsaved changes/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save and export' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Export draft' })).toBeInTheDocument();
    expect(exportDesignZip).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('导出草稿：draft 模式携带草稿全文，不带版本钉', async () => {
    vi.mocked(exportDesignZip).mockResolvedValue({
      blob: new Blob(['zip-bytes']),
      filename: 'draft.zip',
    });
    mount({ dirty: true });
    fireEvent.click(screen.getByRole('button', { name: 'Export draft' }));
    await waitFor(() =>
      expect(exportDesignZip).toHaveBeenCalledWith('remote-1', {
        sessionId: 's1',
        path: 'design/index.html',
        mode: 'draft',
        draftSource: '<html><body>draft</body></html>',
      })
    );
    const request = vi.mocked(exportDesignZip).mock.calls[0][1];
    expect(request).not.toHaveProperty('expectedRevision');
    expect(request).not.toHaveProperty('confirmIncomplete');
    expect(await screen.findByText('Exported: draft.zip')).toBeInTheDocument();
  });

  it('保存并导出：先保存，成功后以新磁盘修订走 disk 导出', async () => {
    let resolveSave!: (value: string | null) => void;
    const onSave = vi
      .fn()
      .mockImplementation(() => new Promise<string | null>(resolve => (resolveSave = resolve)));
    vi.mocked(exportDesignZip).mockResolvedValue({
      blob: new Blob(['zip-bytes']),
      filename: 'saved.zip',
    });
    mount({ dirty: true, onSave });
    fireEvent.click(screen.getByRole('button', { name: 'Save and export' }));
    expect(await screen.findByText('Saving…')).toBeInTheDocument();
    expect(exportDesignZip).not.toHaveBeenCalled();
    await act(async () => {
      resolveSave('rev-new');
    });
    await waitFor(() =>
      expect(exportDesignZip).toHaveBeenCalledWith('remote-1', {
        sessionId: 's1',
        path: 'design/index.html',
        mode: 'disk',
        expectedRevision: 'rev-new',
      })
    );
    expect(await screen.findByText('Exported: saved.zip')).toBeInTheDocument();
  });

  it('保存并导出：save 失败时停留对话框并显示错误，不发起导出', async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    const { onClose } = mount({ dirty: true, onSave });
    fireEvent.click(screen.getByRole('button', { name: 'Save and export' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Save failed, so the export was stopped; resolve the save problem and try again.'
    );
    expect(exportDesignZip).not.toHaveBeenCalled();
    expect(saveBlobToFile).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('EXPORT_INCOMPLETE：列出缺失清单，确认后以 confirmIncomplete 重试', async () => {
    vi.mocked(exportDesignZip)
      .mockRejectedValueOnce(
        new DesignHttpError('缺少资源', 'EXPORT_INCOMPLETE', ['assets/gone.png', 'assets/x.css'])
      )
      .mockResolvedValue({ blob: new Blob(['zip-bytes']), filename: 'ok.zip' });
    mount();
    expect(await screen.findByText('assets/gone.png')).toBeInTheDocument();
    expect(screen.getByText('assets/x.css')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export anyway (the manifest will note missing files)' }));
    await waitFor(() => expect(exportDesignZip).toHaveBeenCalledTimes(2));
    expect(exportDesignZip).toHaveBeenLastCalledWith('remote-1', {
      sessionId: 's1',
      path: 'design/index.html',
      mode: 'disk',
      expectedRevision: 'rev-disk',
      confirmIncomplete: true,
    });
    expect(await screen.findByText('Exported: ok.zip')).toBeInTheDocument();
  });

  it('REVISION_CONFLICT：提示正在刷新并触发一次面板 refreshNow', async () => {
    vi.mocked(exportDesignZip).mockRejectedValue(
      new DesignHttpError('版本冲突', 'REVISION_CONFLICT')
    );
    const { onRefresh } = mount();
    expect(await screen.findByText('The file has changed; refreshing.')).toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(saveBlobToFile).not.toHaveBeenCalled();
  });

  it('其余错误显示 message，可重试同一请求', async () => {
    vi.mocked(exportDesignZip).mockRejectedValue(new Error('Network interrupted'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Network interrupted');
    vi.mocked(exportDesignZip).mockResolvedValue({
      blob: new Blob(['zip-bytes']),
      filename: 'retry.zip',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Exported: retry.zip')).toBeInTheDocument();
    expect(exportDesignZip).toHaveBeenCalledTimes(2);
  });

  it('进行中禁用按钮并显示状态文案', async () => {
    let resolveExport!: (value: { blob: Blob; filename: string }) => void;
    vi.mocked(exportDesignZip).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveExport = resolve;
        })
    );
    mount();
    expect(await screen.findByText('Exporting…')).toBeInTheDocument();
    // Modal 右上角 X 与页脚按钮都叫 "Close"，页脚按钮带可见文本，按此区分。
    const footerClose = screen
      .getAllByRole('button', { name: 'Close' })
      .find(button => button.textContent?.trim() === 'Close')!;
    expect(footerClose).toBeDisabled();
    await act(async () => {
      resolveExport({ blob: new Blob(['zip-bytes']), filename: 'done.zip' });
    });
    expect(await screen.findByText('Exported: done.zip')).toBeInTheDocument();
    expect(footerClose).toBeEnabled();
  });
});
