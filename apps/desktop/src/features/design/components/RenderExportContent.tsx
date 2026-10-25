import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { saveBlobToFile } from '../../../services/fileDownload';
import { DECK_RATIO_DIMENSIONS, filterSlideInPreviewHtml, type DeckInfo } from '../deck';
import { buildImagePdf } from '../pdf';
import type { PdfJpegPage } from '../pdf';
import {
  RenderCaptureError,
  buildPageCaptureRequest,
  buildRenderExportFilename,
  captureHtmlImage,
} from '../render-export';

/** 单页错误：page = 页码（1 基）；null = 非页面错误（如 PDF 组装失败）。 */
interface PageError {
  page: number | null;
  message: string;
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'running'; total: number; current: number }
  | {
      kind: 'done';
      total: number;
      /** 成功捕获的页数（PDF 模式 = 进入 PDF 的页数，非落盘文件数）。 */
      succeeded: number;
      files: string[];
      errors: PageError[];
      cancelled: boolean;
      pdfName: string | null;
    };

export interface RenderExportContentProps {
  open: boolean;
  onClose: () => void;
  /** 入口 HTML 工作区相对路径（导出文件名基准）。 */
  entryPath: string;
  /** 已构建的活动页静态预览 HTML；null = 构建中（禁用导出按钮）。 */
  previewHtml: string | null;
  /** deck 结构；null = 非 deck 页（仅视口区域 PNG）。 */
  deck: DeckInfo | null;
  /** 当前视口（非 deck 页捕获请求用）。 */
  viewport: { preset: string; width: number | null };
}

const CAPTURE_UNSUPPORTED_NOTICE = 'Page capture is not supported in this environment';
const CAPTURE_FAILED_NOTICE = 'Page capture failed';

/** RenderCaptureError 中文映射；其余 Error 用 message，非 Error 用 String。 */
function describeCaptureError(error: unknown): string {
  if (error instanceof RenderCaptureError) {
    return error.code === 'capture-unsupported' ? CAPTURE_UNSUPPORTED_NOTICE : CAPTURE_FAILED_NOTICE;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * 渲染导出内容（P5a §4.8）：deck 页逐页 filterSlideInPreviewHtml →
 * captureHtmlImage（PDF 用 image/jpeg 0.92 → 一次 buildImagePdf 整页图片 PDF；
 * PNG 逐页 saveBlobToFile 下载），非 deck 页按视口区域单张 PNG。导出内容 =
 * 当前预览（含未保存修改）。单页失败进错误列表、其余页继续；取消置标志位，
 * 当前页完成后停止（已下载文件不撤销）；open 切换 / 卸载后不再 setState。
 * 动作行随内容一起渲染，供合并对话框直接复用。
 */
export function RenderExportContent({
  open,
  onClose,
  entryPath,
  previewHtml,
  deck,
  viewport,
}: RenderExportContentProps) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  /** 取消标志位：置位后当前页完成后停止。 */
  const cancelRef = useRef(false);
  /** 会话代号：open 切换 / 取消时递增，旧异步流程的回调随之失效（不再 setState）。 */
  const runIdRef = useRef(0);
  const liveRef = useRef(true);
  /** 进行中流程的已收集结果（取消时立即以已收集内容汇总）。 */
  const progressRef = useRef<{ total: number; succeeded: number; files: string[]; errors: PageError[] }>({
    total: 0,
    succeeded: 0,
    files: [],
    errors: [],
  });

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  // open 切换重置全部状态；进行中的流程一并作废（runId 递增使其回调失效）。
  useEffect(() => {
    runIdRef.current += 1;
    cancelRef.current = false;
    setStage({ kind: 'idle' });
  }, [open]);

  const canUpdate = (runId: number): boolean => liveRef.current && runIdRef.current === runId;

  const update = (runId: number, next: Stage): void => {
    if (canUpdate(runId)) setStage(next);
  };

  const cancel = (): void => {
    if (stage.kind !== 'running') return;
    cancelRef.current = true;
    runIdRef.current += 1;
    const progress = progressRef.current;
    setStage({
      kind: 'done',
      total: progress.total,
      succeeded: progress.succeeded,
      files: [...progress.files],
      errors: [...progress.errors],
      cancelled: true,
      pdfName: null,
    });
  };

  /** deck 导出：逐页捕获 →（PDF）收集后一次 buildImagePdf + 单次落盘 /（PNG）逐页下载。 */
  const runDeckExport = async (
    runId: number,
    mode: 'pdf' | 'png',
    deckInfo: DeckInfo,
    html: string
  ): Promise<void> => {
    const total = deckInfo.slides.length;
    const dims = DECK_RATIO_DIMENSIONS[deckInfo.ratio];
    const pdfPages: PdfJpegPage[] = [];
    for (let index = 0; index < total; index += 1) {
      if (cancelRef.current) break;
      update(runId, { kind: 'running', total, current: index + 1 });
      try {
        const capture = await captureHtmlImage({
          html: filterSlideInPreviewHtml(html, index),
          width: dims.width,
          height: dims.height,
          mime: mode === 'pdf' ? 'image/jpeg' : 'image/png',
          ...(mode === 'pdf' ? { quality: 0.92 } : {}),
        });
        if (cancelRef.current) break; // 当前页捕获完成即停：取消后不再落盘（已下载文件不撤销）。
        if (mode === 'pdf') {
          pdfPages.push({
            widthPx: capture.width,
            heightPx: capture.height,
            jpegBytes: new Uint8Array(await capture.blob.arrayBuffer()),
          });
          progressRef.current.succeeded += 1;
        } else {
          const filename = buildRenderExportFilename(entryPath, 'png', index);
          await saveBlobToFile(capture.blob, filename);
          progressRef.current.files.push(filename);
          progressRef.current.succeeded += 1;
        }
      } catch (error) {
        // 单页失败进错误列表，其余页继续。
        progressRef.current.errors.push({ page: index + 1, message: describeCaptureError(error) });
      }
    }
    if (!canUpdate(runId)) return;
    const { files, errors, succeeded } = progressRef.current;
    if (cancelRef.current) {
      setStage({
        kind: 'done',
        total,
        succeeded,
        files: [...files],
        errors: [...errors],
        cancelled: true,
        pdfName: null,
      });
      return;
    }
    if (mode === 'pdf' && pdfPages.length > 0) {
      try {
        const bytes = buildImagePdf(pdfPages);
        // Uint8Array<ArrayBufferLike> → BlobPart（对齐 fileDownload.ts 的既有口径）。
        const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
        const filename = buildRenderExportFilename(entryPath, 'pdf');
        await saveBlobToFile(blob, filename);
        files.push(filename);
      } catch (error) {
        errors.push({ page: null, message: describeCaptureError(error) });
      }
    }
    setStage({
      kind: 'done',
      total,
      succeeded,
      files: [...files],
      errors: [...errors],
      cancelled: false,
      pdfName: mode === 'pdf' ? (files[0] ?? null) : null,
    });
  };

  /** 非 deck 导出：视口区域单张 PNG。 */
  const runPageExport = async (runId: number, html: string): Promise<void> => {
    update(runId, { kind: 'running', total: 1, current: 1 });
    try {
      const capture = await captureHtmlImage(buildPageCaptureRequest(html, viewport));
      if (cancelRef.current) return;
      const filename = buildRenderExportFilename(entryPath, 'png');
      await saveBlobToFile(capture.blob, filename);
      progressRef.current.files.push(filename);
      progressRef.current.succeeded += 1;
    } catch (error) {
      progressRef.current.errors.push({ page: 1, message: describeCaptureError(error) });
    }
    if (!canUpdate(runId)) return;
    const { files, errors, succeeded } = progressRef.current;
    setStage({
      kind: 'done',
      total: 1,
      succeeded,
      files: [...files],
      errors: [...errors],
      cancelled: false,
      pdfName: null,
    });
  };

  const startDeckExport = (mode: 'pdf' | 'png'): void => {
    if (deck === null || previewHtml === null) return;
    cancelRef.current = false;
    progressRef.current = { total: deck.slides.length, succeeded: 0, files: [], errors: [] };
    void runDeckExport(runIdRef.current, mode, deck, previewHtml);
  };

  const startPageExport = (): void => {
    if (previewHtml === null) return;
    cancelRef.current = false;
    progressRef.current = { total: 1, succeeded: 0, files: [], errors: [] };
    void runPageExport(runIdRef.current, previewHtml);
  };

  const exportDisabled = previewHtml === null;
  return (
    <>
      <div className="flex flex-col gap-3 p-4 text-xs">
        <div className="text-muted-foreground">
          The export contains the current preview (including unsaved changes); the PDF is a full-page image with non-editable text.
        </div>
        {stage.kind === 'idle' && previewHtml === null && (
          <div role="status" className="text-muted-foreground">
            Building preview…
          </div>
        )}
        {stage.kind === 'running' && (
          <div role="status" className="text-muted-foreground">
            Exporting {stage.current}/{stage.total}…
          </div>
        )}
        {stage.kind === 'done' && (
          <>
            {stage.cancelled ? (
              <div role="status" className="text-muted-foreground">
                Canceled: {stage.succeeded}/{stage.total} pages succeeded; downloaded files are kept.
              </div>
            ) : stage.succeeded === 0 ? (
              <div role="alert" className="text-destructive">
                Export failed: all {stage.total} pages failed.
              </div>
            ) : stage.pdfName !== null ? (
              <div role="status" className="text-success">
                Exported: {stage.pdfName} ({stage.succeeded}/{stage.total} pages succeeded)
              </div>
            ) : (
              <div role="status" className="text-success">
                Export finished: {stage.succeeded}/{stage.total} pages succeeded.
              </div>
            )}
            {stage.errors.length > 0 && (
              <>
                <div className="text-warning">The following pages failed to export:</div>
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border px-2 py-1.5">
                  {stage.errors.map((error, index) => (
                    <li key={`${error.page ?? 'pdf'}-${index}`} className="text-destructive">
                      {error.page === null ? error.message : `Page ${error.page}: ${error.message}`}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        {stage.kind === 'running' ? (
          <>
            <Button size="sm" onClick={cancel} aria-label="Cancel export">
              Cancel
            </Button>
            <Button size="sm" onClick={onClose} disabled>
              Close
            </Button>
          </>
        ) : stage.kind === 'idle' ? (
          <>
            {deck !== null && (
              <Button size="sm" onClick={() => startDeckExport('png')} disabled={exportDisabled}>
                Export PNG (one download per page)
              </Button>
            )}
            {deck !== null ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() => startDeckExport('pdf')}
                disabled={exportDisabled}
              >
                Export PDF ({deck.slides.length} pages · full-page image)
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={startPageExport} disabled={exportDisabled}>
                Export PNG (viewport area)
              </Button>
            )}
            <Button size="sm" onClick={onClose}>
              Close
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    </>
  );
}
