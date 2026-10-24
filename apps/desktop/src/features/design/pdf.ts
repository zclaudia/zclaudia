/**
 * P5.4 渲染导出：零依赖 JPEG 直通 PDF 写入器（P5 设计文档 §6.1）。
 * 每页一张 JPEG 的整页图片 PDF（无文字层、不可编辑文字）。
 * JPEG 字节原样透传（/DCTDecode），不解析图像数据；对象布局、xref 表与
 * trailer 全部手写，字节级可测。
 */

/** 单页输入：捕获画布的逻辑像素尺寸 + JPEG 原始字节。 */
export interface PdfJpegPage {
  widthPx: number;
  heightPx: number;
  jpegBytes: Uint8Array;
}

export interface BuildImagePdfOptions {
  /** 缺省 96；pt = px * 72 / dpi（四舍五入）。 */
  dpi?: number;
}

const PDF_VERSION_HEADER = '%PDF-1.4\n';
/** 二进制注释行：4 个 >0x7f 的字节，向解析器声明本文件含二进制流。 */
const BINARY_COMMENT_BYTES = [0xe2, 0xe3, 0xcf, 0xd3];
const MAX_PDF_PAGES = 200;
const MIN_DIMENSION_PX = 1;
const MAX_DIMENSION_PX = 10000;
const MIN_JPEG_BYTES = 4;
const JPEG_SOI_0 = 0xff;
const JPEG_SOI_1 = 0xd8;

/** 单字节 latin1 编码：PDF 结构串均为 ASCII，JPEG 直通走独立字节块。 */
function encodeLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function validatePages(pages: readonly PdfJpegPage[]): void {
  if (pages.length === 0) throw new Error('PDF export failed: at least one page is required');
  if (pages.length > MAX_PDF_PAGES) {
    throw new Error(`PDF export failed: page count ${pages.length} exceeds the limit of ${MAX_PDF_PAGES}`);
  }
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const label = `Page ${index + 1}`;
    if (
      !Number.isFinite(page.widthPx) ||
      page.widthPx < MIN_DIMENSION_PX ||
      page.widthPx > MAX_DIMENSION_PX ||
      !Number.isFinite(page.heightPx) ||
      page.heightPx < MIN_DIMENSION_PX ||
      page.heightPx > MAX_DIMENSION_PX
    ) {
      throw new Error(
        `PDF export failed: ${label} dimensions out of range (${MIN_DIMENSION_PX}–${MAX_DIMENSION_PX}px)`
      );
    }
    if (!(page.jpegBytes instanceof Uint8Array) || page.jpegBytes.length < MIN_JPEG_BYTES) {
      throw new Error(`PDF export failed: ${label} has invalid JPEG data (length too short: fewer than ${MIN_JPEG_BYTES} bytes)`);
    }
    if (page.jpegBytes[0] !== JPEG_SOI_0 || page.jpegBytes[1] !== JPEG_SOI_1) {
      throw new Error(`PDF export failed: ${label} data is not a valid JPEG (missing SOI marker)`);
    }
  }
}

/**
 * 构建整页图片 PDF：对象 1 = Catalog，2 = Pages，之后每页三对象 =
 * Page（/MediaBox pt）→ Image XObject（/DCTDecode 直通）→ Content stream
 * （`q wPt 0 0 hPt 0 0 cm /ImN Do Q`）。xref 表偏移逐一计算，trailer 指向
 * Catalog，`%%EOF` 结尾。
 */
export function buildImagePdf(pages: readonly PdfJpegPage[], options?: BuildImagePdfOptions): Uint8Array {
  validatePages(pages);
  const dpi = options?.dpi ?? 96;
  if (!Number.isFinite(dpi) || dpi <= 0) throw new Error('PDF export failed: dpi must be a positive number');

  const pageObjectNumber = (index: number): number => 3 + index * 3;
  const totalObjects = 2 + pages.length * 3;
  const offsets: number[] = new Array(totalObjects + 1).fill(0);

  const chunks: Uint8Array[] = [];
  let offset = 0;
  const pushBytes = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const pushAscii = (text: string): void => pushBytes(encodeLatin1(text));
  const beginObject = (objectNumber: number): void => {
    offsets[objectNumber] = offset;
    pushAscii(`${objectNumber} 0 obj\n`);
  };

  pushAscii(PDF_VERSION_HEADER);
  pushAscii(`%${String.fromCharCode(...BINARY_COMMENT_BYTES)}\n`);

  beginObject(1);
  pushAscii('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const kids = pages.map((_, index) => `${pageObjectNumber(index)} 0 R`).join(' ');
  beginObject(2);
  pushAscii(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, index) => {
    const widthPt = Math.round((page.widthPx * 72) / dpi);
    const heightPt = Math.round((page.heightPx * 72) / dpi);
    const imageNumber = pageObjectNumber(index) + 1;
    const contentNumber = pageObjectNumber(index) + 2;

    beginObject(pageObjectNumber(index));
    pushAscii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] ` +
        `/Resources << /XObject << /Im${index} ${imageNumber} 0 R >> >> ` +
        `/Contents ${contentNumber} 0 R >>\nendobj\n`
    );

    beginObject(imageNumber);
    pushAscii(
      `<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
        `/Length ${page.jpegBytes.length} >>\nstream\n`
    );
    pushBytes(page.jpegBytes);
    pushAscii('\nendstream\nendobj\n');

    const content = `q ${widthPt} 0 0 ${heightPt} 0 0 cm /Im${index} Do Q`;
    beginObject(contentNumber);
    pushAscii(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  });

  const startxref = offset;
  pushAscii(`xref\n0 ${totalObjects + 1}\n`);
  pushAscii('0000000000 65535 f \n');
  for (let objectNumber = 1; objectNumber <= totalObjects; objectNumber += 1) {
    pushAscii(
      `${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`
    );
  }
  pushAscii(`trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}
