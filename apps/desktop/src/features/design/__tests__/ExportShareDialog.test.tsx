import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ExportShareDialog } from '../components/ExportShareDialog';
import type { ExportShareDialogProps } from '../components/ExportShareDialog';
import { exportDesignZip } from '../api';
import type { DesignShareComment, DesignShareSummary, DesignSnapshotSummary } from '../api';
import {
  createDesignShare,
  getDesignSnapshotFile,
  listDesignShareComments,
  listDesignShares,
  listDesignSnapshots,
  revokeDesignShare,
  setDesignShareCommentResolved,
} from '../api';
import { saveBlobToFile } from '../../../services/fileDownload';
import { DECK_RATIO_DIMENSIONS, filterSlideInPreviewHtml } from '../deck';
import type { DeckInfo } from '../deck';
import { captureHtmlImage } from '../render-export';

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
    isDesignHttpError: (error: unknown): error is DesignHttpError =>
      error instanceof DesignHttpError,
    createDesignShare: vi.fn(),
    listDesignShares: vi.fn(),
    revokeDesignShare: vi.fn(),
    listDesignShareComments: vi.fn(),
    setDesignShareCommentResolved: vi.fn(),
    listDesignSnapshots: vi.fn(),
    getDesignSnapshotFile: vi.fn(),
  };
});

vi.mock('../../../services/fileDownload', () => ({
  saveBlobToFile: vi.fn(),
}));

vi.mock('../../../services/api/base', () => ({
  getBaseUrlForBackend: vi.fn(() => 'http://127.0.0.1:4123'),
}));

// captureHtmlImage 全程 mock；render-export 其余纯函数、pdf.ts、deck.ts 均为真实现。
vi.mock('../render-export', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, captureHtmlImage: vi.fn() };
});

const ENTRY_PATH = 'design/deck.html';
const PREVIEW_HTML =
  '<!doctype html><html><body>' +
  '<section data-zclaudia-slide data-title="封面"><h1>封面</h1></section>' +
  '<section data-zclaudia-slide><p>第二页</p></section>' +
  '<section data-zclaudia-slide><p>第三页</p></section>' +
  '</body></html>';
const CURRENT_SOURCE = '<html><body><h1>标题文本</h1></body></html>';

function makeDeck(count = 3): DeckInfo {
  return {
    slides: Array.from({ length: count }, (_, index) => ({
      index,
      elementPath: [index],
      title: `第 ${index + 1} 页`,
      notes: '',
      tagName: 'section',
      span: { start: 0, end: 0 },
    })),
    ratio: '16:9',
    siblings: true,
  };
}

function makeSnapshot(overrides: Partial<DesignSnapshotSummary> = {}): DesignSnapshotSummary {
  return {
    id: 'ds-1',
    entryPath: 'design/index.html',
    label: 'V1',
    source: 'save',
    complete: true,
    incompleteReasons: [],
    fileCount: 1,
    totalBytes: 100,
    createdAt: new Date('2026-10-23T10:00:00').getTime(),
    ...overrides,
  };
}

function makeShare(overrides: Partial<DesignShareSummary> = {}): DesignShareSummary {
  return {
    id: 'sh-1',
    token: 'tok-1',
    snapshotId: 'ds-1',
    entryPath: 'design/index.html',
    title: '首发审阅',
    scope: 'link',
    createdAt: new Date('2026-10-23T10:00:00').getTime(),
    expiresAt: null,
    revokedAt: null,
    commentCount: 0,
    lastAccessAt: null,
    ...overrides,
  };
}

function makeComment(overrides: Partial<DesignShareComment> = {}): DesignShareComment {
  return {
    id: 'c1',
    author: '审阅人',
    body: '请把标题改成蓝色',
    target: null,
    createdAt: new Date('2026-10-23T11:00:00').getTime(),
    resolvedAt: null,
    ...overrides,
  };
}

function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

interface DeferredCapture {
  promise: Promise<{ blob: Blob; width: number; height: number }>;
  resolve: (result: { blob: Blob; width: number; height: number }) => void;
}

/** 每次调用入队一个手动决议的 deferred（切页签 / 关闭重开测试用）。 */
function queueCaptures(): DeferredCapture[] {
  const queue: DeferredCapture[] = [];
  vi.mocked(captureHtmlImage).mockImplementation(() => {
    let resolve!: (result: { blob: Blob; width: number; height: number }) => void;
    const promise = new Promise<{ blob: Blob; width: number; height: number }>(res => {
      resolve = res;
    });
    queue.push({ promise, resolve });
    return promise;
  });
  return queue;
}

function makeProps(overrides: Partial<ExportShareDialogProps> = {}): ExportShareDialogProps {
  return {
    open: true,
    onClose: vi.fn(),
    exportProps: {
      backendId: 'remote-1',
      sessionId: 's1',
      path: 'design/index.html',
      dirty: false,
      expectedRevision: 'rev-1',
      draftSource: '<html><body>draft</body></html>',
      onSave: vi.fn().mockResolvedValue('rev-saved'),
      onRefresh: vi.fn(),
      cssDirty: false,
    },
    renderProps: {
      entryPath: ENTRY_PATH,
      previewHtml: PREVIEW_HTML,
      deck: makeDeck(),
      viewport: { preset: 'fill', width: null },
    },
    shareProps: {
      backendId: 'remote-1',
      sessionId: 's1',
      docPath: 'design/index.html',
      currentSource: CURRENT_SOURCE,
      onHandoff: vi.fn(),
    },
    ...overrides,
  };
}

function mount(overrides: Partial<ExportShareDialogProps> = {}) {
  const props = makeProps(overrides);
  const utils = render(<ExportShareDialog {...props} />);
  return {
    props,
    rerender: (next: Partial<ExportShareDialogProps> = {}) =>
      utils.rerender(<ExportShareDialog {...props} {...next} />),
  };
}

function panel(testId: 'export' | 'render' | 'share'): HTMLElement {
  return screen.getByTestId(`export-share-panel-${testId}`);
}

describe('ExportShareDialog（P5a §4.8）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(exportDesignZip).mockResolvedValue({
      blob: new Blob(['zip-bytes']),
      filename: 'index.zip',
    });
    vi.mocked(saveBlobToFile).mockResolvedValue('/Downloads/index.zip');
    vi.mocked(captureHtmlImage).mockImplementation(async request => ({
      blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: request.mime }),
      width: request.width,
      height: request.height,
    }));
    vi.mocked(listDesignSnapshots).mockResolvedValue([makeSnapshot()]);
    vi.mocked(listDesignShares).mockResolvedValue({ shares: [makeShare()] });
    vi.mocked(listDesignShareComments).mockResolvedValue({ comments: [] });
    vi.mocked(createDesignShare).mockResolvedValue({
      share: makeShare({ id: 'sh-new', token: 'tok-new' }),
      shareUrl: 'http://127.0.0.1:4123/s/tok-new',
      lanUrls: [],
    });
    vi.mocked(revokeDesignShare).mockResolvedValue({
      share: makeShare({ revokedAt: 1 }),
    });
    vi.mocked(setDesignShareCommentResolved).mockResolvedValue({ comment: makeComment() });
    vi.mocked(getDesignSnapshotFile).mockResolvedValue({
      path: 'design/index.html',
      data: toBase64Utf8(CURRENT_SOURCE),
    });
  });

  it('三个内容同时挂载；切页签只改 hidden/aria-selected 并保持节点身份与自动导出次数', async () => {
    mount();
    const dialog = screen.getByRole('dialog', { name: 'Export & Share' });

    // 默认 Export 页签；三个内容都已挂载。
    expect(within(dialog).getByRole('tab', { name: 'Export ZIP' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(panel('export')).not.toHaveAttribute('hidden');
    expect(panel('render')).toHaveAttribute('hidden');
    expect(panel('share')).toHaveAttribute('hidden');
    // Export 内容（当前可见，干净页自动导出）与 Render/Share 内容（hidden 但已挂载）。
    expect(await within(panel('export')).findByText('Exported: index.zip')).toBeInTheDocument();
    const renderNotice = within(panel('render')).getByText(
      'The export contains the current preview (including unsaved changes); the PDF is a full-page image with non-editable text.'
    );
    const shareInput = within(panel('share')).getByLabelText('Share title');
    // 隐藏的 Share 内容打开即加载（无轮询），证明内容确实挂载。
    await waitFor(() => expect(listDesignShares).toHaveBeenCalledWith(
      'remote-1',
      's1',
      'design/index.html'
    ));
    expect(exportDesignZip).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Share' }));
    expect(panel('export')).toHaveAttribute('hidden');
    expect(panel('render')).toHaveAttribute('hidden');
    expect(panel('share')).not.toHaveAttribute('hidden');
    expect(within(dialog).getByRole('tab', { name: 'Share' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    // 节点身份不变：切页签没有卸载/重挂内容，Export 也没有重新自动导出。
    expect(within(panel('share')).getByLabelText('Share title')).toBe(shareInput);
    expect(panel('render')).toContainElement(renderNotice);
    expect(exportDesignZip).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Render PNG/PDF' }));
    expect(panel('render')).not.toHaveAttribute('hidden');
    expect(panel('share')).toHaveAttribute('hidden');
    expect(panel('export')).toHaveAttribute('hidden');
    expect(within(panel('share')).getByLabelText('Share title')).toBe(shareInput);

    fireEvent.click(within(dialog).getByRole('tab', { name: 'Export ZIP' }));
    expect(panel('export')).not.toHaveAttribute('hidden');
    expect(exportDesignZip).toHaveBeenCalledTimes(1);
  });

  it('deck 渲染导出进行中切走再切回：同一 run 继续推进并完成（不重启、不丢进度）', async () => {
    const queue = queueCaptures();
    mount();
    const dialog = screen.getByRole('dialog', { name: 'Export & Share' });
    const renderPanel = panel('render');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Render PNG/PDF' }));
    fireEvent.click(
      within(renderPanel).getByRole('button', { name: 'Export PNG (one download per page)' })
    );
    expect(await within(renderPanel).findByText('Exporting 1/3…')).toBeInTheDocument();
    expect(captureHtmlImage).toHaveBeenCalledTimes(1);

    // 切到 Share 再切回 Render：内容保持挂载（hidden），进度仍是同一 run 的 1/3。
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Share' }));
    expect(renderPanel).toHaveAttribute('hidden');
    expect(within(renderPanel).getByText('Exporting 1/3…')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Render PNG/PDF' }));
    expect(panel('render')).toBe(renderPanel);
    expect(within(renderPanel).getByText('Exporting 1/3…')).toBeInTheDocument();
    expect(captureHtmlImage).toHaveBeenCalledTimes(1);

    await act(async () => {
      queue[0].resolve({ blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])]), width: 1600, height: 900 });
    });
    expect(await within(renderPanel).findByText('Exporting 2/3…')).toBeInTheDocument();
    await act(async () => {
      queue[1].resolve({ blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])]), width: 1600, height: 900 });
    });
    expect(await within(renderPanel).findByText('Exporting 3/3…')).toBeInTheDocument();
    await act(async () => {
      queue[2].resolve({ blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])]), width: 1600, height: 900 });
    });

    expect(await within(renderPanel).findByText('Export finished: 3/3 pages succeeded.')).toBeInTheDocument();
    expect(captureHtmlImage).toHaveBeenCalledTimes(3);
    // 逐页捕获仍按 deck 比例与页序；下载文件按入口路径命名。
    for (let index = 0; index < 3; index += 1) {
      expect(captureHtmlImage).toHaveBeenNthCalledWith(index + 1, {
        html: filterSlideInPreviewHtml(PREVIEW_HTML, index),
        width: DECK_RATIO_DIMENSIONS['16:9'].width,
        height: DECK_RATIO_DIMENSIONS['16:9'].height,
        mime: 'image/png',
      });
    }
    const downloads = vi
      .mocked(saveBlobToFile)
      .mock.calls.map(call => call[1])
      .filter(name => name.startsWith('deck-slide-'));
    expect(downloads).toEqual(['deck-slide-00.png', 'deck-slide-01.png', 'deck-slide-02.png']);
  });

  it('关闭再打开：页签复位到 Export，渲染状态回到 idle 且重新打开仍自动导出 ZIP', async () => {
    const queue = queueCaptures();
    const { rerender } = mount();
    const dialog = screen.getByRole('dialog', { name: 'Export & Share' });
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Render PNG/PDF' }));
    fireEvent.click(
      within(panel('render')).getByRole('button', { name: 'Export PNG (one download per page)' })
    );
    expect(await within(panel('render')).findByText('Exporting 1/3…')).toBeInTheDocument();
    expect(exportDesignZip).toHaveBeenCalledTimes(1);

    rerender({ open: false });
    expect(screen.queryByRole('dialog', { name: 'Export & Share' })).not.toBeInTheDocument();

    rerender({ open: true });
    const reopened = screen.getByRole('dialog', { name: 'Export & Share' });
    // 新一次打开默认 Export，且原渲染进度不会残留。
    expect(within(reopened).getByRole('tab', { name: 'Export ZIP' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(within(panel('render')).queryByText(/Exporting \d\/\d…/)).not.toBeInTheDocument();
    expect(
      within(panel('render')).getByText('Export PDF (3 pages · full-page image)')
    ).toBeEnabled();
    // 干净页每次打开仍自动导出 ZIP（原语义不变）。
    await waitFor(() => expect(exportDesignZip).toHaveBeenCalledTimes(2));
    // 旧 run 的第一个捕获仍未决议，不阻塞新打开的内容。
    expect(queue).toHaveLength(1);
  });

  it('Share 页签交接：上抛含评论正文的 prompt，对话框自身不关闭（父级负责 prefill + 关闭）', async () => {
    vi.mocked(listDesignShareComments).mockResolvedValue({
      comments: [makeComment({ id: 'c1', body: '请把标题改成蓝色' })],
    });
    const { props } = mount();
    const dialog = screen.getByRole('dialog', { name: 'Export & Share' });
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Share' }));
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Review comments' }));
    const handoff = await within(dialog).findByRole('button', { name: 'Hand off to Agent c1' });
    fireEvent.click(handoff);
    await waitFor(() => expect(props.shareProps.onHandoff).toHaveBeenCalledTimes(1));
    const prompt = vi.mocked(props.shareProps.onHandoff).mock.calls[0][0];
    expect(prompt).toContain('请把标题改成蓝色');
    expect(prompt).toContain('Instruction');
    expect(getDesignSnapshotFile).toHaveBeenCalledWith('remote-1', 's1', 'ds-1', 'design/index.html');
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Export & Share' })).toBeInTheDocument();
  });
});
