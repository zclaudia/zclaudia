// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { downscaleImageFile, MAX_DIMENSION } from '../downscale-image';

function mockBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() };
}

describe('downscaleImageFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('passes GIFs through untouched', async () => {
    const f = new File(['x'], 'anim.gif', { type: 'image/gif' });
    expect(await downscaleImageFile(f)).toBe(f);
  });

  it('passes non-images through untouched', async () => {
    const f = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    expect(await downscaleImageFile(f)).toBe(f);
  });

  it('passes small images through untouched', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => mockBitmap(800, 600)));
    const f = new File(['x'], 'small.png', { type: 'image/png' });
    expect(await downscaleImageFile(f)).toBe(f);
  });

  it('downscales oversized images to MAX_DIMENSION JPEG', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => mockBitmap(3136, 1568)));
    const drawImage = vi.fn();
    const toBlob = vi.fn((cb: (b: Blob) => void) => cb(new Blob(['jpg'], { type: 'image/jpeg' })));
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as never);
    const f = new File(['x'], 'big.png', { type: 'image/png' });
    const out = await downscaleImageFile(f);
    expect(canvas.width).toBe(MAX_DIMENSION);
    expect(canvas.height).toBe(784);
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('big.jpg');
  });

  it('falls back to the original file when decoding fails', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('bad image'); }));
    const f = new File(['x'], 'broken.png', { type: 'image/png' });
    expect(await downscaleImageFile(f)).toBe(f);
  });
});
