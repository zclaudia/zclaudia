import { describe, expect, it } from 'vitest';
import { buildImagePdf, type PdfJpegPage } from '../pdf';

/** 保真 latin1 视图（每字节 → 同码位字符），供子串断言。 */
const toStr = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

const PAGE_ONE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x11, 0x7f, 0x8a, 0x01, 0x02]);
const PAGE_TWO_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x33, 0x99, 0xab, 0xcd, 0xfe]);

const twoPageDoc = (): Uint8Array =>
  buildImagePdf([
    { widthPx: 1600, heightPx: 900, jpegBytes: PAGE_ONE_JPEG },
    { widthPx: 1280, heightPx: 720, jpegBytes: PAGE_TWO_JPEG },
  ]);

function bytesIndexOf(haystack: Uint8Array, needle: Uint8Array): number {
  const limit = haystack.length - needle.length;
  for (let i = 0; i <= limit; i += 1) {
    let matched = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

function bytesCount(haystack: Uint8Array, needle: Uint8Array): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = bytesIndexOf(haystack.subarray(from), needle);
    if (at < 0) return count;
    count += 1;
    from += at + 1;
  }
}

describe('buildImagePdf', () => {
  it('writes a %PDF-1.4 header, a binary comment line with 4 bytes >0x7f, and a %%EOF footer', () => {
    const bytes = twoPageDoc();
    expect(toStr(bytes.slice(0, 8))).toBe('%PDF-1.4');
    expect(bytes[8]).toBe(0x0a);
    expect(bytes[9]).toBe(0x25); // '%'
    for (let i = 10; i <= 13; i += 1) expect(bytes[i]).toBeGreaterThan(0x7f);
    expect(bytes[14]).toBe(0x0a);
    expect(toStr(bytes.slice(-6))).toBe('%%EOF\n');
  });

  it('emits exactly one /Type /Page object per page with /Count and /Kids', () => {
    const text = toStr(twoPageDoc());
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/Kids [3 0 R 6 0 R]');
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Pages 2 0 R');
    expect(text).toContain('/Im0 Do');
    expect(text).toContain('/Im1 Do');
  });

  it('converts pixel sizes to pt at 96 dpi in /MediaBox and the content stream', () => {
    const text = toStr(twoPageDoc());
    expect(text).toContain('/MediaBox [0 0 1200 675]');
    expect(text).toContain('1200 0 0 675 0 0 cm');
    expect(text).toContain('/MediaBox [0 0 960 540]');
    expect(text).toContain('960 0 0 540 0 0 cm');
  });

  it('rounds pt values to the nearest integer', () => {
    const text = toStr(
      buildImagePdf([{ widthPx: 899, heightPx: 901, jpegBytes: PAGE_ONE_JPEG }])
    );
    // 899 * 72 / 96 = 674.25 → 674；901 * 72 / 96 = 675.75 → 676
    expect(text).toContain('/MediaBox [0 0 674 676]');
    expect(text).toContain('674 0 0 676 0 0 cm');
  });

  it('halves pt dimensions when dpi is 192', () => {
    const text = toStr(
      buildImagePdf([{ widthPx: 1600, heightPx: 800, jpegBytes: PAGE_ONE_JPEG }], { dpi: 192 })
    );
    expect(text).toContain('/MediaBox [0 0 600 300]');
    expect(text).toContain('600 0 0 300 0 0 cm');
  });

  it('embeds each page as a /DCTDecode XObject with pixel dimensions and exact /Length', () => {
    const text = toStr(twoPageDoc());
    expect(text.match(/\/Filter \/DCTDecode/g)).toHaveLength(2);
    expect(text).toContain('/Width 1600');
    expect(text).toContain('/Height 900');
    expect(text).toContain('/Width 1280');
    expect(text).toContain('/Height 720');
    expect(text).toContain('/ColorSpace /DeviceRGB');
    expect(text).toContain('/BitsPerComponent 8');
    expect(text).toContain(`/Length ${PAGE_ONE_JPEG.length}`);
    expect(text).toContain(`/Length ${PAGE_TWO_JPEG.length}`);
  });

  it('passes JPEG bytes through verbatim, once per page, in page order', () => {
    const bytes = twoPageDoc();
    const first = bytesIndexOf(bytes, PAGE_ONE_JPEG);
    const second = bytesIndexOf(bytes, PAGE_TWO_JPEG);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(bytesCount(bytes, PAGE_ONE_JPEG)).toBe(1);
    expect(bytesCount(bytes, PAGE_TWO_JPEG)).toBe(1);
  });

  it('writes an xref table whose offsets each point at the matching "N 0 obj" header', () => {
    const bytes = twoPageDoc();
    const text = toStr(bytes);
    const startMatch = /startxref\n(\d+)\n%%EOF\n$/.exec(text);
    expect(startMatch).not.toBeNull();
    const startxref = Number(startMatch![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');

    const tail = text.slice(startxref);
    const header = /^xref\n0 (\d+)\n/.exec(tail);
    expect(header).not.toBeNull();
    const count = Number(header![1]);
    expect(count).toBe(9); // 8 个在用对象 + 对象 0 的空闲表项

    const entries = tail.slice(header![0].length);
    for (let objectNumber = 0; objectNumber < count; objectNumber += 1) {
      const entry = entries.slice(objectNumber * 20, (objectNumber + 1) * 20);
      expect(entry).toMatch(/^\d{10} \d{5} [nf] \n$/);
      if (objectNumber === 0) {
        expect(entry.charAt(17)).toBe('f');
        expect(entry.slice(11, 16)).toBe('65535');
      } else {
        expect(entry.charAt(17)).toBe('n');
        const objectOffset = Number(entry.slice(0, 10));
        const marker = `${objectNumber} 0 obj`;
        expect(text.slice(objectOffset, objectOffset + marker.length)).toBe(marker);
      }
    }
  });

  it('writes a trailer with /Root and /Size covering every object plus the free entry', () => {
    const twoPages = toStr(twoPageDoc());
    expect(twoPages).toContain('trailer\n<< /Size 9 /Root 1 0 R >>');
    const onePage = toStr(
      buildImagePdf([{ widthPx: 800, heightPx: 600, jpegBytes: PAGE_ONE_JPEG }])
    );
    expect(onePage).toContain('/Kids [3 0 R]');
    expect(onePage).toContain('<< /Size 6 /Root 1 0 R >>');
  });

  it('rejects an empty page list with a Chinese message', () => {
    expect(() => buildImagePdf([])).toThrow('at least one page is required');
  });

  it('rejects more than 200 pages', () => {
    const pages: PdfJpegPage[] = Array.from({ length: 201 }, () => ({
      widthPx: 800,
      heightPx: 600,
      jpegBytes: PAGE_ONE_JPEG,
    }));
    expect(() => buildImagePdf(pages)).toThrow('exceeds the limit of 200');
    expect(() => buildImagePdf(pages.slice(0, 200))).not.toThrow();
  });

  it('rejects out-of-range page dimensions', () => {
    expect(() =>
      buildImagePdf([{ widthPx: 0, heightPx: 600, jpegBytes: PAGE_ONE_JPEG }])
    ).toThrow('dimensions out of range');
    expect(() =>
      buildImagePdf([{ widthPx: 800, heightPx: 10001, jpegBytes: PAGE_ONE_JPEG }])
    ).toThrow('dimensions out of range');
  });

  it('rejects jpegBytes that do not start with 0xFF 0xD8', () => {
    expect(() =>
      buildImagePdf([
        { widthPx: 800, heightPx: 600, jpegBytes: new Uint8Array([0xff, 0x00, 0xd8, 0x00]) },
      ])
    ).toThrow('SOI');
  });

  it('rejects jpegBytes shorter than 4 bytes', () => {
    expect(() =>
      buildImagePdf([
        { widthPx: 800, heightPx: 600, jpegBytes: new Uint8Array([0xff, 0xd8, 0x00]) },
      ])
    ).toThrow('length too short');
  });
});
