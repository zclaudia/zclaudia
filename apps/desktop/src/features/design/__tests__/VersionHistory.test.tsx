import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VersionHistory } from '../components/VersionHistory';
import type { VersionHistoryProps } from '../components/VersionHistory';
import * as api from '../api';
import type { DesignConflictFile, DesignSnapshotDetail } from '../api';
import type { DesignSnapshotSummary } from '../types';

vi.mock('../api', () => ({
  listDesignSnapshots: vi.fn(),
  createDesignSnapshot: vi.fn(),
  getDesignSnapshotDetail: vi.fn(),
  getDesignSnapshotFile: vi.fn(),
  restoreDesignSnapshot: vi.fn(),
}));

const summary = (overrides: Partial<DesignSnapshotSummary> = {}): DesignSnapshotSummary => ({
  id: 'ds-1',
  entryPath: 'design/index.html',
  label: null,
  source: 'save',
  complete: true,
  incompleteReasons: [],
  fileCount: 2,
  totalBytes: 2048,
  createdAt: new Date('2026-10-23T10:00:00').getTime(),
  ...overrides,
});

const detail = (overrides: {
  summary?: Partial<DesignSnapshotSummary>;
  files?: DesignSnapshotDetail['files'];
} = {}): DesignSnapshotDetail => ({
  summary: summary(overrides.summary),
  files:
    overrides.files ??
    ([
      { path: 'design/index.html', sha256: 'sha-entry', bytes: 1024, kind: 'entry', mime: 'text/html' },
      { path: 'design/style.css', sha256: 'sha-css', bytes: 1024, kind: 'css', mime: 'text/css' },
    ] as DesignSnapshotDetail['files']),
});

function mount(overrides: Partial<VersionHistoryProps> = {}) {
  const props: VersionHistoryProps = {
    backendId: 'remote-1',
    sessionId: 's1',
    docPath: 'design/index.html',
    currentSource: '<html>current</html>',
    busy: false,
    dirty: false,
    restore: vi.fn().mockResolvedValue({ ok: true }),
    onRestored: vi.fn(),
    onReload: vi.fn(),
    ...overrides,
  };
  render(<VersionHistory {...props} />);
  return {
    restore: props.restore as ReturnType<typeof vi.fn>,
    onRestored: props.onRestored as ReturnType<typeof vi.fn>,
    onReload: props.onReload as ReturnType<typeof vi.fn>,
  };
}

const conflictFile = (path: string, reason?: string): DesignConflictFile =>
  reason ? { path, reason } : { path };

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleString('zh-CN', { hour12: false });

describe('VersionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.createDesignSnapshot).mockResolvedValue(summary({ source: 'manual' }));
    vi.mocked(api.getDesignSnapshotDetail).mockResolvedValue(detail());
  });

  it('renders the version list with time, badges and sizes', async () => {
    const first = summary({ source: 'save' });
    const second = summary({
      id: 'ds-2',
      source: 'manual',
      label: '首版',
      createdAt: new Date('2026-10-22T09:00:00').getTime(),
      totalBytes: 4096,
    });
    vi.mocked(api.listDesignSnapshots).mockResolvedValue([first, second]);
    mount();
    await waitFor(() =>
      expect(api.listDesignSnapshots).toHaveBeenCalledWith('remote-1', 's1', 'design/index.html')
    );
    expect(await screen.findByText('保存')).toBeInTheDocument();
    expect(screen.getByText('手动')).toBeInTheDocument();
    expect(screen.getByText('首版')).toBeInTheDocument();
    expect(screen.getByText('2 个文件 · 2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('2 个文件 · 4.0 KB')).toBeInTheDocument();
    expect(screen.getByText(formatTime(first.createdAt))).toBeInTheDocument();
    expect(screen.getByText(formatTime(second.createdAt))).toBeInTheDocument();
  });

  it('shows an incomplete badge and expands the reasons on click', async () => {
    vi.mocked(api.listDesignSnapshots).mockResolvedValue([
      summary({ complete: false, incompleteReasons: ['design/logo.png: 超出大小限制'] }),
    ]);
    mount();
    expect(await screen.findByText('不完整')).toBeInTheDocument();
    expect(screen.queryByText(/design\/logo.png/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '不完整原因 ds-1' }));
    expect(await screen.findByText('design/logo.png: 超出大小限制')).toBeInTheDocument();
  });

  it('captures a manual snapshot from the save button, with the label input', async () => {
    vi.mocked(api.listDesignSnapshots).mockResolvedValue([]);
    mount();
    await screen.findByText(/暂无版本快照/);
    fireEvent.change(screen.getByRole('textbox', { name: '版本备注' }), {
      target: { value: '手工备份' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存版本' }));
    await waitFor(() =>
      expect(api.createDesignSnapshot).toHaveBeenCalledWith('remote-1', {
        sessionId: 's1',
        path: 'design/index.html',
        source: 'manual',
        label: '手工备份',
      })
    );
    expect(await screen.findByRole('status')).toHaveTextContent('已创建版本快照');
    await waitFor(() => expect(api.listDesignSnapshots).toHaveBeenCalledTimes(2));
  });

  it('disables manual capture while the draft is dirty', async () => {
    vi.mocked(api.listDesignSnapshots).mockResolvedValue([]);
    mount({ dirty: true });
    await screen.findByText(/暂无版本快照/);
    expect(screen.getByRole('button', { name: '保存版本' })).toBeDisabled();
    expect(api.createDesignSnapshot).not.toHaveBeenCalled();
  });

  it('runs the restore confirmation flow with the file manifest', async () => {
    vi.mocked(api.listDesignSnapshots).mockResolvedValue([summary()]);
    const { restore, onRestored } = mount();
    fireEvent.click(await screen.findByRole('button', { name: '恢复此版本' }));
    expect(await screen.findByRole('dialog', { name: '恢复此版本' })).toBeInTheDocument();
    expect(await screen.findByText('design/style.css')).toBeInTheDocument();
    expect(screen.getByText(/将写入 2 个文件/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith(
        'ds-1',
        {
          'design/index.html': 'sha-entry',
          'design/style.css': 'sha-css',
        },
        {}
      )
    );
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent('已恢复到所选版本');
    expect(screen.queryByRole('dialog', { name: '恢复此版本' })).not.toBeInTheDocument();
  });

  it('shows the conflict file list with reload guidance on RESTORE_CONFLICT', async () => {
    vi.mocked(api.listDesignSnapshots).mockResolvedValue([summary()]);
    const { onReload, onRestored } = mount({
      restore: vi.fn().mockResolvedValue({
        ok: false,
        errorCode: 'RESTORE_CONFLICT',
        conflictFiles: [conflictFile('design/index.html', '内容已变化'), conflictFile('design/style.css')],
      }),
    });
    fireEvent.click(await screen.findByRole('button', { name: '恢复此版本' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认恢复' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('恢复已取消');
    expect(screen.getByText('design/index.html')).toBeInTheDocument();
    expect(screen.getByText(/内容已变化/)).toBeInTheDocument();
    expect(screen.getByText('design/style.css')).toBeInTheDocument();
    expect(onRestored).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '重新载入' }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: '恢复此版本' })).not.toBeInTheDocument();
  });

  it('requires a second confirmation before restoring an incomplete snapshot', async () => {
    vi.mocked(api.listDesignSnapshots).mockResolvedValue([summary({ complete: false })]);
    vi.mocked(api.getDesignSnapshotDetail).mockResolvedValue(
      detail({ summary: { complete: false, incompleteReasons: ['design/bg.png: 超出大小限制'] } })
    );
    const { restore } = mount();
    fireEvent.click(await screen.findByRole('button', { name: '恢复此版本' }));
    const dialog = await screen.findByRole('dialog', { name: '恢复此版本' });
    expect(dialog).toHaveTextContent('此快照不完整');
    expect(dialog).toHaveTextContent('design/bg.png: 超出大小限制');

    fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
    expect(restore).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent('仍要恢复请再次点击「仍要恢复」');

    fireEvent.click(screen.getByRole('button', { name: '仍要恢复' }));
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith(
        'ds-1',
        expect.any(Object),
        { confirmIncomplete: true }
      )
    );
  });

  it('asks the server for the detail and reports fetch failures', async () => {
    vi.mocked(api.listDesignSnapshots).mockResolvedValue([summary()]);
    vi.mocked(api.getDesignSnapshotDetail).mockRejectedValue(new Error('snapshot not found'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '恢复此版本' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('snapshot not found');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
