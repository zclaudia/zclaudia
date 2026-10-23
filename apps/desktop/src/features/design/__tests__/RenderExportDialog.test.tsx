import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RenderExportDialog } from '../components/RenderExportDialog';
import type { RenderExportDialogProps } from '../components/RenderExportDialog';
import {
  RenderCaptureError,
  buildPageCaptureRequest,
  buildRenderExportFilename,
  captureHtmlImage,
} from '../render-export';
import { DECK_RATIO_DIMENSIONS, filterSlideInPreviewHtml } from '../deck';
import type { DeckInfo, DeckRatio } from '../deck';
import { saveBlobToFile } from '../../../services/fileDownload';

// captureHtmlImage 全程 mock（成功返回固定 blob，可按调用次序配置失败）；
// render-export 其余纯函数、pdf.ts、deck.ts 均为真实现。
vi.mock('../render-export', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, captureHtmlImage: vi.fn() };
});

vi.mock('../../../services/fileDownload', () => ({
  saveBlobToFile: vi.fn(),
}));

const ENTRY_PATH = 'design/deck.html';
const PREVIEW_HTML =
  '<!doctype html><html><head><script>window.bridge = 1;</script></head><body>' +
  '<section data-zclaudia-slide data-title="封面"><h1>封面</h1></section>' +
  '<section data-zclaudia-slide><p>第二页</p></section>' +
  '<section data-zclaudia-slide><p>第三页</p></section>' +
  '</body></html>';

function makeDeck(count = 3, ratio: DeckRatio = '16:9'): DeckInfo {
  return {
    slides: Array.from({ length: count }, (_, index) => ({
      index,
      elementPath: [index],
      title: `第 ${index + 1} 页`,
      notes: '',
      tagName: 'section',
      span: { start: 0, end: 0 },
    })),
    ratio,
    siblings: true,
  };
}

/** buildImagePdf（真实现）要求 JPEG 以 SOI 开头。 */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x20, 0x30]);

function okCapture(): void {
  vi.mocked(captureHtmlImage).mockImplementation(async request => ({
    blob: new Blob([JPEG_BYTES], { type: request.mime }),
    width: request.width,
    height: request.height,
  }));
}

interface DeferredCapture {
  promise: Promise<{ blob: Blob; width: number; height: number }>;
  resolve: (result: { blob: Blob; width: number; height: number }) => void;
  reject: (error: unknown) => void;
}

/** 每次调用入队一个手动决议的 deferred（取消 / 进度推进测试用）。 */
function queueCaptures(): DeferredCapture[] {
  const queue: DeferredCapture[] = [];
  vi.mocked(captureHtmlImage).mockImplementation(() => {
    let resolve!: (result: { blob: Blob; width: number; height: number }) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<{ blob: Blob; width: number; height: number }>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    queue.push({ promise, resolve, reject });
    return promise;
  });
  return queue;
}

function mount(overrides: Partial<RenderExportDialogProps> = {}) {
  const props: RenderExportDialogProps = {
    open: true,
    onClose: vi.fn(),
    entryPath: ENTRY_PATH,
    previewHtml: PREVIEW_HTML,
    deck: makeDeck(),
    viewport: { preset: 'fill', width: null },
    ...overrides,
  };
  const utils = render(<RenderExportDialog {...props} />);
  return {
    props,
    rerender: (next: Partial<RenderExportDialogProps> = {}) =>
      utils.rerender(<RenderExportDialog {...props} {...next} />),
  };
}

describe('RenderExportDialog（P5 §6.3）', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(saveBlobToFile).mockResolvedValue('/Downloads/deck.pdf');
  });

  it('deck PDF：逐页 jpeg 捕获后一次 buildImagePdf，以 <base>.pdf 落盘', async () => {
    okCapture();
    mount();
    fireEvent.click(screen.getByRole('button', { name: '导出 PDF（3 页 · 整页图片）' }));
    await waitFor(() => expect(captureHtmlImage).toHaveBeenCalledTimes(3));
    for (let index = 0; index < 3; index += 1) {
      expect(captureHtmlImage).toHaveBeenNthCalledWith(index + 1, {
        html: filterSlideInPreviewHtml(PREVIEW_HTML, index),
        width: DECK_RATIO_DIMENSIONS['16:9'].width,
        height: DECK_RATIO_DIMENSIONS['16:9'].height,
        mime: 'image/jpeg',
        quality: 0.92,
      });
    }
    expect(saveBlobToFile).toHaveBeenCalledTimes(1);
    const [blob, filename] = vi.mocked(saveBlobToFile).mock.calls[0];
    expect(filename).toBe(buildRenderExportFilename(ENTRY_PATH, 'pdf'));
    expect(blob.type).toBe('application/pdf');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 3');
    expect(text).toContain('/MediaBox [0 0 1200 675]'); // 1600×900 @96dpi
    expect(text).toContain('/Filter /DCTDecode');
    const soi = bytes.findIndex(
      (byte, i) => byte === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff
    );
    expect(soi).toBeGreaterThan(0); // JPEG 字节直通进 PDF 流
    expect(await screen.findByText('已导出：deck.pdf（成功 3/3 页）')).toBeInTheDocument();
  });

  it('deck PNG：逐页 image/png 捕获并逐页下载 <base>-slide-0N.png', async () => {
    okCapture();
    mount();
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG（逐页下载）' }));
    await waitFor(() => expect(saveBlobToFile).toHaveBeenCalledTimes(3));
    for (let index = 0; index < 3; index += 1) {
      expect(captureHtmlImage).toHaveBeenNthCalledWith(index + 1, {
        html: filterSlideInPreviewHtml(PREVIEW_HTML, index),
        width: DECK_RATIO_DIMENSIONS['16:9'].width,
        height: DECK_RATIO_DIMENSIONS['16:9'].height,
        mime: 'image/png',
      });
      expect(vi.mocked(captureHtmlImage).mock.calls[index][0]).not.toHaveProperty('quality');
      expect(saveBlobToFile).toHaveBeenNthCalledWith(
        index + 1,
        expect.any(Blob),
        buildRenderExportFilename(ENTRY_PATH, 'png', index)
      );
    }
    expect(await screen.findByText('导出完成：成功 3/3 页。')).toBeInTheDocument();
  });

  it('非 deck：以 buildPageCaptureRequest 的视口请求捕获，单张 <base>.png 落盘', async () => {
    okCapture();
    const viewport = { preset: 'tablet', width: 768 };
    mount({ deck: null, viewport });
    expect(screen.queryByRole('button', { name: /导出 PDF/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '导出 PNG（逐页下载）' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG（视口区域）' }));
    await waitFor(() => expect(saveBlobToFile).toHaveBeenCalledTimes(1));
    expect(captureHtmlImage).toHaveBeenCalledTimes(1);
    expect(captureHtmlImage).toHaveBeenCalledWith(buildPageCaptureRequest(PREVIEW_HTML, viewport));
    expect(saveBlobToFile).toHaveBeenCalledWith(
      expect.any(Blob),
      buildRenderExportFilename(ENTRY_PATH, 'png')
    );
    expect(await screen.findByText('导出完成：成功 1/1 页。')).toBeInTheDocument();
  });

  it('非 deck：fill 视口（width null）回退 1280×900', async () => {
    okCapture();
    mount({ deck: null, viewport: { preset: 'fill', width: null } });
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG（视口区域）' }));
    await waitFor(() => expect(saveBlobToFile).toHaveBeenCalledTimes(1));
    expect(captureHtmlImage).toHaveBeenCalledWith(
      buildPageCaptureRequest(PREVIEW_HTML, { preset: 'fill', width: null })
    );
  });

  it('固定说明文案恒定展示', () => {
    mount();
    expect(
      screen.getByText('导出内容为当前预览（含未保存修改）；PDF 为整页图片，不可编辑文字。')
    ).toBeInTheDocument();
  });

  it('单页失败进错误列表且其余页继续（RenderCaptureError 中文映射 + 其余 Error 用 message）', async () => {
    mount();
    vi.mocked(captureHtmlImage)
      .mockRejectedValueOnce(new Error('磁盘已满'))
      .mockRejectedValueOnce(new RenderCaptureError('capture-failed', '页面捕获失败：预览图片加载失败'))
      .mockImplementationOnce(async request => ({
        blob: new Blob([JPEG_BYTES], { type: request.mime }),
        width: request.width,
        height: request.height,
      }));
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG（逐页下载）' }));
    await waitFor(() => expect(saveBlobToFile).toHaveBeenCalledTimes(1));
    expect(captureHtmlImage).toHaveBeenCalledTimes(3);
    expect(saveBlobToFile).toHaveBeenNthCalledWith(1, expect.any(Blob), 'deck-slide-02.png');
    expect(await screen.findByText('导出完成：成功 1/3 页。')).toBeInTheDocument();
    expect(screen.getByText('以下页面导出失败：')).toBeInTheDocument();
    expect(screen.getByText('第 1 页：磁盘已满')).toBeInTheDocument();
    expect(screen.getByText('第 2 页：页面捕获失败')).toBeInTheDocument();
    expect(screen.queryByText(/^第 3 页/)).not.toBeInTheDocument();
  });

  it('全部失败：alert 汇总且不落盘', async () => {
    vi.mocked(captureHtmlImage).mockRejectedValue(
      new RenderCaptureError('capture-unsupported', '当前环境不支持页面捕获（无 Canvas 2D）')
    );
    mount();
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG（逐页下载）' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('导出失败：3 页全部失败。');
    expect(screen.getByText('第 1 页：当前环境不支持页面捕获')).toBeInTheDocument();
    expect(screen.getByText('第 3 页：当前环境不支持页面捕获')).toBeInTheDocument();
    expect(saveBlobToFile).not.toHaveBeenCalled();
    expect(captureHtmlImage).toHaveBeenCalledTimes(3);
  });

  it('取消：立即汇总已收集结果；当前页捕获完成后不再落盘、不再捕获后续页', async () => {
    const queue = queueCaptures();
    mount();
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG（逐页下载）' }));
    expect(await screen.findByText('正在导出 1/3…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消导出' }));
    expect(await screen.findByText('已取消：成功 0/3 页，已下载文件保留。')).toBeInTheDocument();
    await act(async () => {
      queue[0].resolve({ blob: new Blob([JPEG_BYTES], { type: 'image/png' }), width: 1600, height: 900 });
    });
    expect(captureHtmlImage).toHaveBeenCalledTimes(1);
    expect(saveBlobToFile).not.toHaveBeenCalled();
    expect(screen.getByText('已取消：成功 0/3 页，已下载文件保留。')).toBeInTheDocument();
  });

  it('进度文案：正在导出 i/N… 逐页推进直至成功汇总', async () => {
    const queue = queueCaptures();
    mount();
    fireEvent.click(screen.getByRole('button', { name: '导出 PDF（3 页 · 整页图片）' }));
    expect(await screen.findByText('正在导出 1/3…')).toBeInTheDocument();
    await act(async () => {
      queue[0].resolve({ blob: new Blob([JPEG_BYTES], { type: 'image/jpeg' }), width: 1600, height: 900 });
    });
    expect(await screen.findByText('正在导出 2/3…')).toBeInTheDocument();
    await act(async () => {
      queue[1].resolve({ blob: new Blob([JPEG_BYTES], { type: 'image/jpeg' }), width: 1600, height: 900 });
    });
    expect(await screen.findByText('正在导出 3/3…')).toBeInTheDocument();
    await act(async () => {
      queue[2].resolve({ blob: new Blob([JPEG_BYTES], { type: 'image/jpeg' }), width: 1600, height: 900 });
    });
    expect(await screen.findByText('已导出：deck.pdf（成功 3/3 页）')).toBeInTheDocument();
  });

  it('previewHtml 为 null：显示「正在构建预览…」并禁用导出按钮', () => {
    mount({ previewHtml: null });
    expect(screen.getByText('正在构建预览…')).toBeInTheDocument();
    const pdf = screen.getByRole('button', { name: '导出 PDF（3 页 · 整页图片）' });
    const png = screen.getByRole('button', { name: '导出 PNG（逐页下载）' });
    expect(pdf).toBeDisabled();
    expect(png).toBeDisabled();
    fireEvent.click(pdf);
    fireEvent.click(png);
    expect(captureHtmlImage).not.toHaveBeenCalled();
  });

  it('open 切换重置全部状态：完成后关闭再打开回到初始态，不自动导出', async () => {
    okCapture();
    const { rerender } = mount();
    fireEvent.click(screen.getByRole('button', { name: '导出 PNG（逐页下载）' }));
    expect(await screen.findByText('导出完成：成功 3/3 页。')).toBeInTheDocument();
    rerender({ open: false });
    rerender({ open: true });
    expect(screen.queryByText('导出完成：成功 3/3 页。')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出 PDF（3 页 · 整页图片）' })).toBeEnabled();
    expect(captureHtmlImage).toHaveBeenCalledTimes(3);
  });
});
