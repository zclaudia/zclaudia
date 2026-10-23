/**
 * P5.4 渲染导出纯逻辑（P5 设计文档 §6.2）：SVG foreignObject → canvas
 * 捕获、非 deck 页视口捕获请求构建与导出文件名。
 * deck 单页捕获请求与 PDF 组装由 RenderExportDialog（L24）接线，
 * 此处不依赖 deck.ts（避免与 L21 并行竞态）。
 */

/** 捕获请求：预览 HTML + 逻辑像素尺寸（1–10000）。 */
export interface CaptureRequest {
  /** 已构建的预览 HTML（通常经 filterSlideInPreviewHtml）。 */
  html: string;
  width: number;
  height: number;
  mime: 'image/png' | 'image/jpeg';
  /** jpeg 用，缺省 0.92。 */
  quality?: number;
}

export class RenderCaptureError extends Error {
  constructor(
    readonly code: 'capture-unsupported' | 'capture-failed',
    message: string
  ) {
    super(message);
    this.name = 'RenderCaptureError';
  }
}

const IMAGE_LOAD_TIMEOUT_MS = 10000;
const DEFAULT_JPEG_QUALITY = 0.92;
/** 非 deck 页视口区域捕获：fill/custom 统一 1280×900。 */
const PAGE_CAPTURE_WIDTH = 1280;
const PAGE_CAPTURE_HEIGHT = 900;
const CAPTURE_MIN_SIZE = 1;
const CAPTURE_MAX_SIZE = 10000;

/** DOMParser → XMLSerializer：foreignObject 内容必须是良构 XHTML
 * （outerHTML 的未闭合 void 元素会令 SVG 图片加载失败）。 */
function serializeWellFormed(html: string): string {
  return new XMLSerializer().serializeToString(
    new DOMParser().parseFromString(html, 'text/html').documentElement
  );
}

/** data URL SVG → Image；onerror 或 10s 超时 → capture-failed。 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const fail = (error: RenderCaptureError): void => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new RenderCaptureError('capture-failed', '页面捕获失败：预览图片加载超时')),
      IMAGE_LOAD_TIMEOUT_MS
    );
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () =>
      fail(new RenderCaptureError('capture-failed', '页面捕获失败：预览图片加载失败'));
    image.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: 'image/png' | 'image/jpeg',
  quality: number | undefined
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

/**
 * 捕获管线：html 良构化 → svg/foreignObject 包裹 → data URL → Image →
 * canvas 白底填充（避免透明背景 JPEG 变黑）→ toBlob。
 * getContext / toBlob 不可用 → capture-unsupported。
 */
export async function captureHtmlImage(
  request: CaptureRequest
): Promise<{ blob: Blob; width: number; height: number }> {
  const serialized = serializeWellFormed(request.html);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${request.width}" height="${request.height}" ` +
    `viewBox="0 0 ${request.width} ${request.height}">` +
    '<foreignObject width="100%" height="100%">' +
    serialized +
    '</foreignObject></svg>';
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);

  const canvas = document.createElement('canvas');
  canvas.width = request.width;
  canvas.height = request.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new RenderCaptureError('capture-unsupported', '当前环境不支持页面捕获（无 Canvas 2D）');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, request.width, request.height);
  context.drawImage(image, 0, 0);

  const quality = request.quality ?? (request.mime === 'image/jpeg' ? DEFAULT_JPEG_QUALITY : undefined);
  const blob = await canvasToBlob(canvas, request.mime, quality);
  if (!blob) {
    throw new RenderCaptureError('capture-unsupported', '当前环境不支持页面捕获（图片编码失败）');
  }
  return { blob, width: request.width, height: request.height };
}

function clampCaptureSize(value: number): number {
  if (!Number.isFinite(value)) return CAPTURE_MIN_SIZE;
  return Math.min(Math.max(Math.round(value), CAPTURE_MIN_SIZE), CAPTURE_MAX_SIZE);
}

/**
 * 非 deck 页视口区域捕获请求：视口带数值宽度（desktop/tablet/mobile/custom）
 * 则 宽×900，fill（width null）回退 1280×900；上限 10000。输出 image/png
 * （deck 单页捕获请求由 L24 组装）。
 */
export function buildPageCaptureRequest(
  previewHtml: string,
  viewport: { preset: string; width: number | null }
): CaptureRequest {
  const width =
    typeof viewport.width === 'number' && Number.isFinite(viewport.width)
      ? viewport.width
      : PAGE_CAPTURE_WIDTH;
  return {
    html: previewHtml,
    width: clampCaptureSize(width),
    height: PAGE_CAPTURE_HEIGHT,
    mime: 'image/png',
  };
}

/**
 * 导出文件名：<base>-slide-01.png / <base>.pdf / <base>.png。base = 入口名
 * 去扩展名，非法字符转 _（对齐服务端 buildExportFilename 口径），空则
 * 'export'；slideIndex 补零两位。
 */
export function buildRenderExportFilename(
  entryPath: string,
  ext: 'png' | 'pdf',
  slideIndex?: number
): string {
  const base = (entryPath.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_') || 'export';
  if (slideIndex === undefined) return `${safe}.${ext}`;
  return `${safe}-slide-${String(slideIndex).padStart(2, '0')}.${ext}`;
}
