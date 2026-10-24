import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeckPresenter } from '../components/DeckPresenter';
import type { DeckPresenterProps } from '../components/DeckPresenter';
import { parseDeck, type DeckSlide } from '../deck';

const DECK_SOURCE = `<!doctype html>
<html>
<head><title>deck</title></head>
<body data-zclaudia-deck-ratio="16:9">
  <section data-zclaudia-slide data-title="第一页" data-notes="备注 A">
    <h2>标题一</h2>
  </section>
  <section data-zclaudia-slide data-title="第二页">
    <h2>标题二</h2>
  </section>
  <section data-zclaudia-slide data-title="第三页">第三页</section>
</body>
</html>`;

const PREVIEW_HTML = `<!doctype html><html><head></head><body>
  <section data-zclaudia-slide data-title="第一页"><h2>标题一</h2></section>
  <section data-zclaudia-slide data-title="第二页"><h2>标题二</h2></section>
  <section data-zclaudia-slide data-title="第三页">第三页</section>
</body></html>`;

const slides = (): DeckSlide[] => parseDeck(DECK_SOURCE).slides;

/** jsdom 无 ResizeObserver：捕获回调以便按 mock 尺寸触发缩放。 */
class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  disconnected = false;
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }

  emit(width: number, height: number): void {
    act(() => {
      this.callback(
        [{ contentRect: { width, height } } as ResizeObserverEntry],
        this as unknown as ResizeObserver
      );
    });
  }
}

const fullscreen = {
  request: vi.fn<() => Promise<void>>(),
  exit: vi.fn<() => Promise<void>>(),
};

function mountProps(overrides: Partial<DeckPresenterProps> = {}): DeckPresenterProps {
  return {
    slides: slides(),
    ratio: '16:9',
    previewHtml: PREVIEW_HTML,
    startIndex: 0,
    onClose: vi.fn(),
    ...overrides,
  };
}

function mount(overrides: Partial<DeckPresenterProps> = {}) {
  const props = mountProps(overrides);
  render(<DeckPresenter {...props} />);
  return { onClose: props.onClose as ReturnType<typeof vi.fn> };
}

const pageLabel = (): string => screen.getByTestId('deck-page-label').textContent ?? '';

describe('DeckPresenter（P5 §5.2）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockResizeObserver.instances = [];
    fullscreen.request.mockImplementation(() => Promise.resolve());
    fullscreen.exit.mockImplementation(() => Promise.resolve());
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    (Element.prototype as unknown as Record<string, unknown>).requestFullscreen =
      fullscreen.request;
    (Document.prototype as unknown as Record<string, unknown>).exitFullscreen = fullscreen.exit;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (Element.prototype as unknown as Record<string, unknown>).requestFullscreen;
    delete (Document.prototype as unknown as Record<string, unknown>).exitFullscreen;
    delete (document as unknown as Record<string, unknown>).fullscreenElement;
  });

  it('挂载即请求全屏，请求被拒绝时静默降级不崩溃', () => {
    fullscreen.request.mockImplementation(() => Promise.reject(new Error('denied')));
    mount();
    expect(fullscreen.request).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('deck-presenter')).toBeInTheDocument();
  });

  it('按比例盒渲染固定逻辑像素 iframe，容器尺寸经 ResizeObserver 量测后缩放', () => {
    mount();
    const box = screen.getByTestId('deck-slide-box');
    expect(box).toHaveStyle({ width: '1600px', height: '900px' });
    const frame = screen.getByTitle('Slide 1');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame).toHaveStyle({ width: '1600px', height: '900px' });

    MockResizeObserver.instances[0]!.emit(1280, 720);
    expect(box).toHaveStyle({ transform: 'scale(0.8)' });
  });

  it('4:3 比例使用 1200×900 逻辑像素并按容器取最小缩放', () => {
    mount({ ratio: '4:3' });
    const box = screen.getByTestId('deck-slide-box');
    expect(box).toHaveStyle({ width: '1200px', height: '900px' });
    MockResizeObserver.instances[0]!.emit(1280, 720);
    expect(box).toHaveStyle({ transform: 'scale(0.8)' });
  });

  it('键盘翻页：ArrowRight/PageDown 下一页，ArrowLeft/PageUp 上一页', async () => {
    mount();
    expect(pageLabel()).toBe('Page 1/3 · 第一页');
    await userEvent.keyboard('{ArrowRight}');
    expect(pageLabel()).toBe('Page 2/3 · 第二页');
    await userEvent.keyboard('{PageDown}');
    expect(pageLabel()).toBe('Page 3/3 · 第三页');
    await userEvent.keyboard('{ArrowLeft}');
    expect(pageLabel()).toBe('Page 2/3 · 第二页');
    await userEvent.keyboard('{PageUp}');
    expect(pageLabel()).toBe('Page 1/3 · 第一页');
  });

  it('Space 下一页；首页 ← 与末页 → 到边界不动', async () => {
    mount();
    await userEvent.keyboard(' ');
    expect(pageLabel()).toBe('Page 2/3 · 第二页');
    await userEvent.keyboard('{ArrowLeft}');
    await userEvent.keyboard('{ArrowLeft}');
    expect(pageLabel()).toBe('Page 1/3 · 第一页');
    await userEvent.keyboard('{ArrowLeft}');
    expect(pageLabel()).toBe('Page 1/3 · 第一页');
    await userEvent.keyboard('{End}');
    await userEvent.keyboard('{ArrowRight}');
    expect(pageLabel()).toBe('Page 3/3 · 第三页');
  });

  it('Home/End 跳首末页', async () => {
    mount({ startIndex: 1 });
    await userEvent.keyboard('{End}');
    expect(pageLabel()).toBe('Page 3/3 · 第三页');
    await userEvent.keyboard('{Home}');
    expect(pageLabel()).toBe('Page 1/3 · 第一页');
  });

  it('Escape 触发 onClose', async () => {
    const { onClose } = mount();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('N 键切换备注：显示当前页备注，空则「无备注」', async () => {
    mount();
    expect(screen.queryByTestId('deck-notes')).not.toBeInTheDocument();
    await userEvent.keyboard('n');
    expect(screen.getByTestId('deck-notes')).toHaveTextContent('备注 A');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByTestId('deck-notes')).toHaveTextContent('No notes');
    await userEvent.keyboard('N');
    expect(screen.queryByTestId('deck-notes')).not.toBeInTheDocument();
  });

  it('底栏备注开关按钮与 N 键同效（aria-pressed 同步）', () => {
    mount();
    const toggle = screen.getByRole('button', { name: 'Notes toggle' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('deck-notes')).toHaveTextContent('备注 A');
  });

  it('底栏翻页按钮翻页并在边界禁用', () => {
    mount();
    const prev = screen.getByRole('button', { name: 'Previous' });
    const next = screen.getByRole('button', { name: 'Next' });
    expect(prev).toBeDisabled();
    fireEvent.click(next);
    expect(pageLabel()).toBe('Page 2/3 · 第二页');
    fireEvent.click(prev);
    expect(pageLabel()).toBe('Page 1/3 · 第一页');
  });

  it('startIndex 指定起始页，越界时收敛到末页', () => {
    mount({ startIndex: 2 });
    expect(pageLabel()).toBe('Page 3/3 · 第三页');
    cleanup();
    mount({ startIndex: 9 });
    expect(pageLabel()).toBe('Page 3/3 · 第三页');
  });

  it('previewHtml 为 null 时显示「正在构建预览…」占位', () => {
    mount({ previewHtml: null });
    expect(screen.getByText('Building preview…')).toBeInTheDocument();
    expect(screen.queryByTestId('deck-slide-box')).not.toBeInTheDocument();
  });

  it('卸载清理：移除 window keydown 监听、断开 ResizeObserver、退出全屏', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    (document as unknown as Record<string, unknown>).fullscreenElement = document.body;
    const { unmount } = render(<DeckPresenter {...mountProps()} />);
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(fullscreen.exit).toHaveBeenCalledTimes(1);
    expect(MockResizeObserver.instances.every(instance => instance.disconnected)).toBe(true);
    removeSpy.mockRestore();
  });

  it('卸载时未处于全屏则不调用 exitFullscreen', () => {
    const { unmount } = render(<DeckPresenter {...mountProps()} />);
    unmount();
    expect(fullscreen.exit).not.toHaveBeenCalled();
  });
});
