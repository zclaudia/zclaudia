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

  it('applies tier stage padding and centers the fixed-width page card', () => {
    const { rerender } = render(
      <PreviewCanvas
        srcDoc="<html><body>p</body></html>"
        viewport={mobileViewport}
        zoom={{ mode: 'manual', value: 1 }}
      />
    );
    const canvas = screen.getByTestId('design-canvas');
    const placeholder = screen.getByTestId('design-canvas-placeholder');
    // 默认 wide：24px 舞台留白；占位宽度由视口决定并水平居中（不再被 minWidth 拉满）。
    expect(canvas).toHaveClass('px-6', 'pt-6');
    expect(placeholder).toHaveClass('mx-auto');
    expect(placeholder.style.minWidth).toBe('');
    expect(placeholder.style.width).toBe('390px');

    rerender(
      <PreviewCanvas
        srcDoc="<html><body>p</body></html>"
        viewport={mobileViewport}
        zoom={{ mode: 'manual', value: 1 }}
        tier="medium"
      />
    );
    expect(canvas).toHaveClass('px-4', 'pt-4');
    expect(canvas).not.toHaveClass('px-6');

    rerender(
      <PreviewCanvas
        srcDoc="<html><body>p</body></html>"
        viewport={mobileViewport}
        zoom={{ mode: 'manual', value: 1 }}
        tier="narrow"
      />
    );
    expect(canvas).toHaveClass('px-3', 'pt-3');
    expect(screen.getByTestId('design-canvas-placeholder')).toHaveClass('mx-auto');
  });

  it('waits for a built preview before mounting the browsing context', () => {
    const props = { viewport: mobileViewport, zoom: { mode: 'fit' as const, value: 1 } };
    const { rerender } = render(<PreviewCanvas {...props} srcDoc="" />);
    expect(screen.queryByTitle('Design preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('design-canvas-placeholder')).toBeInTheDocument();
    rerender(<PreviewCanvas {...props} srcDoc="<html><body>Ready</body></html>" />);
    expect(screen.getByTitle('Design preview')).toHaveAttribute(
      'srcdoc',
      '<html><body>Ready</body></html>'
    );
    const firstFrame = screen.getByTitle('Design preview');
    rerender(<PreviewCanvas {...props} srcDoc="<html><body>Updated</body></html>" />);
    expect(screen.getByTitle('Design preview')).not.toBe(firstFrame);
  });

  it('keeps the fill preset at full width with scale 1 regardless of the zoom value', () => {
    render(
      <PreviewCanvas
        srcDoc="<html><body>preview</body></html>"
        viewport={{ preset: 'fill', width: null }}
        zoom={{ mode: 'manual', value: 1.5 }}
      />
    );
    const frame = screen.getByTitle('Design preview') as HTMLIFrameElement;
    expect(frame.style.width).toBe('100%');
    expect(frame.style.transform).toContain('scale(1)');
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
      <PreviewCanvas
        srcDoc="<html><body>preview</body></html>"
        viewport={mobileViewport}
        zoom={{ mode: 'fit', value: 1 }}
      />
    );
    const frame = screen.getByTitle('Design preview') as HTMLIFrameElement;
    // fit = min(1, 容器 195 / frame 390) = 0.5。
    expect(frame.style.transform).toContain('scale(0.5)');
    expect(screen.getByTestId('design-canvas-placeholder').style.width).toBe('195px');
  });

  it('skips container measurement when ResizeObserver is unavailable (jsdom default)', () => {
    render(
      <PreviewCanvas
        srcDoc="<html><body>preview</body></html>"
        viewport={mobileViewport}
        zoom={{ mode: 'fit', value: 1 }}
      />
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
