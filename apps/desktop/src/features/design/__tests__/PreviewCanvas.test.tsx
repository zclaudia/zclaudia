import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { PreviewCanvas } from '../components/PreviewCanvas';

const mobileViewport = { preset: 'mobile' as const, width: 390 };

describe('PreviewCanvas', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the device width and manual zoom independently (390 + scale 0.5)', () => {
    render(
      <PreviewCanvas
        srcDoc="<html><body>p</body></html>"
        viewport={mobileViewport}
        zoom={{ mode: 'manual', value: 0.5 }}
      />
    );
    const frame = screen.getByTitle('Design preview') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('srcdoc')).toBe('<html><body>p</body></html>');
    expect(frame.style.width).toBe('390px');
    expect(frame.style.transform).toContain('scale(0.5)');
    expect(frame.style.transformOrigin).toBe('top left');
    // 占位 div 撑开滚动尺寸：390 * 0.5 = 195px。
    const placeholder = screen.getByTestId('design-canvas-placeholder');
    expect(placeholder.style.width).toBe('195px');
  });

  it('keeps the fill preset at full width with scale 1 regardless of the zoom value', () => {
    render(
      <PreviewCanvas
        srcDoc=""
        viewport={{ preset: 'fill', width: null }}
        zoom={{ mode: 'manual', value: 1.5 }}
      />
    );
    const frame = screen.getByTitle('Design preview') as HTMLIFrameElement;
    expect(frame.style.width).toBe('100%');
    expect(frame.style.transform).toContain('scale(1)');
    // 空预览串回退到空文档占位。
    expect(frame.getAttribute('srcdoc')).toContain('<body></body>');
  });

  it('computes the fit scale from the measured container width', () => {
    class ResizeObserverStub {
      constructor(private callback: ResizeObserverCallback) {}
      observe = () => {
        this.callback(
          [{ contentRect: { width: 195, height: 400 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver
        );
      };
      unobserve = () => undefined;
      disconnect = () => undefined;
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    render(
      <PreviewCanvas srcDoc="" viewport={mobileViewport} zoom={{ mode: 'fit', value: 1 }} />
    );
    const frame = screen.getByTitle('Design preview') as HTMLIFrameElement;
    // fit = min(1, 容器 195 / frame 390) = 0.5。
    expect(frame.style.transform).toContain('scale(0.5)');
    expect(screen.getByTestId('design-canvas-placeholder').style.width).toBe('195px');
  });

  it('skips container measurement when ResizeObserver is unavailable (jsdom default)', () => {
    render(
      <PreviewCanvas srcDoc="" viewport={mobileViewport} zoom={{ mode: 'fit', value: 1 }} />
    );
    const frame = screen.getByTitle('Design preview') as HTMLIFrameElement;
    expect(frame.style.width).toBe('390px');
    expect(frame.style.transform).toContain('scale(1)');
  });

  it('forwards the load event so the panel can post the verify request', () => {
    const onFrameLoad = vi.fn();
    const frameRef = createRef<HTMLIFrameElement>();
    render(
      <PreviewCanvas
        srcDoc="<html></html>"
        viewport={mobileViewport}
        zoom={{ mode: 'fit', value: 1 }}
        frameRef={frameRef}
        onFrameLoad={onFrameLoad}
      />
    );
    expect(frameRef.current).not.toBeNull();
    const frame = screen.getByTitle('Design preview');
    fireEvent.load(frame);
    expect(onFrameLoad).toHaveBeenCalledTimes(1);
  });
});
