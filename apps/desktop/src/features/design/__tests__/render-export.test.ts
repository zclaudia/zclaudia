// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RenderCaptureError,
  buildPageCaptureRequest,
  buildRenderExportFilename,
  captureHtmlImage,
} from '../render-export';

const DATA_URL_PREFIX = 'data:image/svg+xml;charset=utf-8,';
const BASE_REQUEST = {
  html: '<!DOCTYPE html><html><head><title>t</title></head><body><p>a<br><img src="x.png"></p></body></html>',
  width: 1280,
  height: 900,
  mime: 'image/png',
} as const;

/** 可控 Image：实例入队，测试手动触发 onload/onerror。 */
class MockImage {
  static instances: MockImage[] = [];
  src = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    MockImage.instances.push(this);
  }
}

interface FakeCanvas {
  width: number;
  height: number;
  getContext: ReturnType<typeof vi.fn>;
  toBlob: ReturnType<typeof vi.fn>;
}

interface CanvasMock {
  context: { fillStyle: string; fillRect: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> };
  canvases: FakeCanvas[];
  canvas: () => FakeCanvas | null;
}

/** mock canvas：createElement('canvas') 返回含 getContext/toBlob 的 stub，可断言调用与画布尺寸。 */
function mockCanvas(overrides: { context?: unknown; blob?: Blob | null } = {}): CanvasMock {
  const context =
    'context' in overrides
      ? overrides.context
      : { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  const blob = 'blob' in overrides ? overrides.blob : new Blob(['png-bytes'], { type: 'image/png' });
  const canvases: FakeCanvas[] = [];
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(
    ((tagName: string, options?: ElementCreationOptions) => {
      if (String(tagName).toLowerCase() === 'canvas') {
        const fake: FakeCanvas = {
          width: 0,
          height: 0,
          getContext: vi.fn(() => context),
          toBlob: vi.fn((callback: BlobCallback) => {
            callback(blob);
          }),
        };
        canvases.push(fake);
        return fake as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tagName, options);
    }) as unknown as typeof document.createElement
  );
  return {
    context: context as CanvasMock['context'],
    canvases,
    canvas: () => canvases[canvases.length - 1] ?? null,
  };
}

beforeEach(() => {
  MockImage.instances = [];
  vi.stubGlobal('Image', MockImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('captureHtmlImage', () => {
  it('wraps the html in a well-formed foreignObject svg data URL and draws it on a white-filled canvas', async () => {
    const canvas = mockCanvas();
    const pending = captureHtmlImage({ ...BASE_REQUEST });

    const image = MockImage.instances[0];
    expect(image).toBeInstanceOf(MockImage);
    expect(image.src.startsWith(DATA_URL_PREFIX)).toBe(true);
    const svg = decodeURIComponent(image.src.slice(DATA_URL_PREFIX.length));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(
      '<foreignObject width="100%" height="100%"><html xmlns="http://www.w3.org/1999/xhtml">'
    );
    expect(svg).toContain('</foreignObject></svg>');
    // void 元素经 XMLSerializer 良构化（未闭合的 <br>/<img> 会被闭合）
    expect(svg).toContain('<br />');
    expect(svg).not.toContain('<br>');
    expect(svg).toContain('<img src="x.png" />');

    image.onload?.();
    const result = await pending;
    expect(result.width).toBe(1280);
    expect(result.height).toBe(900);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(canvas.context.fillStyle).toBe('#ffffff');
    expect(canvas.context.fillRect).toHaveBeenCalledWith(0, 0, 1280, 900);
    expect(canvas.context.drawImage).toHaveBeenCalledWith(image, 0, 0);
    expect(canvas.canvas()?.getContext).toHaveBeenCalledWith('2d');
    expect(canvas.canvas()?.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined);
    expect(canvas.canvas()?.width).toBe(1280);
    expect(canvas.canvas()?.height).toBe(900);
  });

  it('defaults jpeg quality to 0.92 and honours an explicit quality', async () => {
    const first = mockCanvas();
    const firstPending = captureHtmlImage({ html: '<p>x</p>', width: 800, height: 600, mime: 'image/jpeg' });
    MockImage.instances[0].onload?.();
    await firstPending;
    expect(first.canvas()?.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92);

    const second = mockCanvas();
    const secondPending = captureHtmlImage({
      html: '<p>x</p>',
      width: 800,
      height: 600,
      mime: 'image/jpeg',
      quality: 0.5,
    });
    MockImage.instances[1].onload?.();
    await secondPending;
    expect(second.canvas()?.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.5);
  });

  it('maps image onerror to a capture-failed error', async () => {
    mockCanvas();
    const pending = captureHtmlImage({ html: '<p>x</p>', width: 800, height: 600, mime: 'image/png' });
    MockImage.instances[0].onerror?.();
    await expect(pending).rejects.toBeInstanceOf(RenderCaptureError);
    await expect(pending).rejects.toMatchObject({ code: 'capture-failed' });
  });

  it('maps the 10s load timeout to a capture-failed error', async () => {
    mockCanvas();
    vi.useFakeTimers();
    const pending = expect(
      captureHtmlImage({ html: '<p>x</p>', width: 800, height: 600, mime: 'image/png' })
    ).rejects.toMatchObject({ code: 'capture-failed' });
    await vi.advanceTimersByTimeAsync(10000);
    await pending;
  });

  it('maps a null 2d context to capture-unsupported', async () => {
    mockCanvas({ context: null });
    const pending = captureHtmlImage({ html: '<p>x</p>', width: 800, height: 600, mime: 'image/png' });
    MockImage.instances[0].onload?.();
    await expect(pending).rejects.toMatchObject({ code: 'capture-unsupported' });
  });

  it('maps a null toBlob result to capture-unsupported', async () => {
    const canvas = mockCanvas({ blob: null });
    const pending = captureHtmlImage({ html: '<p>x</p>', width: 800, height: 600, mime: 'image/png' });
    MockImage.instances[0].onload?.();
    await expect(pending).rejects.toBeInstanceOf(RenderCaptureError);
    await expect(pending).rejects.toMatchObject({ code: 'capture-unsupported' });
    // 失败发生在白底填充与绘制之后
    expect(canvas.context.fillRect).toHaveBeenCalled();
    expect(canvas.context.drawImage).toHaveBeenCalled();
  });
});

describe('buildPageCaptureRequest', () => {
  it('uses 1280×900 png when the viewport has no width (fill)', () => {
    const html = '<body><p>preview</p></body>';
    expect(buildPageCaptureRequest(html, { preset: 'fill', width: null })).toEqual({
      html,
      width: 1280,
      height: 900,
      mime: 'image/png',
    });
  });

  it('uses the viewport width × 900 whenever a numeric width is present', () => {
    const request = buildPageCaptureRequest('<p>', { preset: 'desktop', width: 1440 });
    expect(request.width).toBe(1440);
    expect(request.height).toBe(900);
    expect(request.html).toBe('<p>');
    const custom = buildPageCaptureRequest('<p>', { preset: 'custom', width: 390 });
    expect(custom.width).toBe(390);
  });

  it('clamps the width into 1–10000', () => {
    expect(buildPageCaptureRequest('<p>', { preset: 'tablet', width: 99999 }).width).toBe(10000);
    expect(buildPageCaptureRequest('<p>', { preset: 'mobile', width: 0 }).width).toBe(1);
  });
});

describe('buildRenderExportFilename', () => {
  it('builds <base>.<ext> and zero-padded slide names aligned with the server convention', () => {
    expect(buildRenderExportFilename('site/index.html', 'png')).toBe('index.png');
    expect(buildRenderExportFilename('index.html', 'pdf')).toBe('index.pdf');
    expect(buildRenderExportFilename('docs/a.b.html', 'png')).toBe('a.b.png');
    expect(buildRenderExportFilename('site/index.html', 'png', 1)).toBe('index-slide-01.png');
    expect(buildRenderExportFilename('site/index.html', 'png', 12)).toBe('index-slide-12.png');
    expect(buildRenderExportFilename('site/index.html', 'pdf', 7)).toBe('index-slide-07.pdf');
  });

  it('sanitizes illegal characters and never returns an empty base', () => {
    expect(buildRenderExportFilename('site/我的 页面+v2.html', 'pdf')).toBe('______v2.pdf');
    expect(buildRenderExportFilename('site/首页.html', 'png', 3)).toBe('__-slide-03.png');
    expect(buildRenderExportFilename('', 'pdf')).toBe('export.pdf');
  });
});
