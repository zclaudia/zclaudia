/**
 * Rich-format support for the Read tool: Jupyter notebooks rendered as text
 * cells with outputs, PDF text extraction by page, and downscaling of images
 * that exceed the vision size limit.
 */

const MAX_PDF_PAGES_PER_READ = 20;

// ── Jupyter notebooks ────────────────────────────────────────────────────────

interface NotebookOutput {
  output_type?: string;
  name?: string;
  text?: string | string[];
  data?: Record<string, unknown>;
  ename?: string;
  evalue?: string;
}

interface NotebookCell {
  cell_type?: string;
  execution_count?: number | null;
  source?: string | string[];
  outputs?: NotebookOutput[];
}

function joinSource(source: string | string[] | undefined): string {
  if (Array.isArray(source)) return source.join('');
  return source ?? '';
}

function renderOutput(output: NotebookOutput): string[] {
  if (output.output_type === 'stream') {
    const text = joinSource(output.text).trimEnd();
    return text ? [text] : [];
  }
  if (output.output_type === 'error') {
    return [`${output.ename ?? 'Error'}: ${output.evalue ?? ''}`.trimEnd()];
  }
  if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
    const lines: string[] = [];
    const data = output.data ?? {};
    const plain = data['text/plain'];
    if (plain !== undefined) {
      const text = joinSource(plain as string | string[]).trimEnd();
      if (text) lines.push(text);
    }
    for (const mime of Object.keys(data)) {
      if (mime.startsWith('image/')) lines.push('[image output omitted]');
    }
    return lines;
  }
  return [];
}

/** Render an .ipynb document as readable text: one block per cell, outputs inline. */
export function renderNotebook(raw: string): string {
  const parsed = JSON.parse(raw) as { cells?: NotebookCell[] };
  if (!Array.isArray(parsed.cells)) {
    throw new Error('Not a Jupyter notebook: missing cells array');
  }
  const blocks: string[] = [];
  parsed.cells.forEach((cell, index) => {
    const kind = cell.cell_type ?? 'code';
    const header = `── Cell ${index + 1} [${kind}]${
      typeof cell.execution_count === 'number' ? ` (execution ${cell.execution_count})` : ''} ──`;
    const lines = [header, joinSource(cell.source).trimEnd()];
    const outputs = (cell.outputs ?? []).flatMap(renderOutput);
    if (outputs.length > 0) {
      lines.push('── Output ──', ...outputs);
    }
    blocks.push(lines.filter(line => line.length > 0).join('\n'));
  });
  return blocks.join('\n\n');
}

// ── PDF ──────────────────────────────────────────────────────────────────────

/** Parse a "1-5,8" style page spec into 1-based page numbers, clamped and capped. */
export function parsePageSpec(spec: string | undefined, totalPages: number): number[] {
  const pages = new Set<number>();
  if (spec && spec.trim()) {
    for (const part of spec.split(',')) {
      const trimmed = part.trim();
      const range = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed);
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        for (let page = start; page <= end; page += 1) pages.add(page);
      } else if (/^\d+$/.test(trimmed)) {
        pages.add(Number(trimmed));
      }
    }
  } else {
    for (let page = 1; page <= totalPages; page += 1) pages.add(page);
  }
  return [...pages]
    .filter(page => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b)
    .slice(0, MAX_PDF_PAGES_PER_READ);
}

export interface PdfExtraction {
  text: string;
  totalPages: number;
  pages: number[];
}

export async function extractPdfText(buffer: Buffer, pageSpec?: string): Promise<PdfExtraction> {
  const { extractText } = await import('unpdf');
  const { totalPages, text } = await extractText(new Uint8Array(buffer), { mergePages: false });
  const pages = parsePageSpec(pageSpec, totalPages);
  const sections = pages.map(page => `── Page ${page} of ${totalPages} ──\n${(text[page - 1] ?? '').trim()}`);
  return { text: sections.join('\n\n'), totalPages, pages };
}

// ── Oversized images ─────────────────────────────────────────────────────────

export interface CompressedImage {
  data: Buffer;
  mimeType: string;
}

/**
 * Downscale an image until it fits maxBytes (re-encoded as JPEG, which vision
 * models accept regardless of the source format). Returns undefined when the
 * format is unsupported or compression cannot reach the limit.
 */
export async function compressImageToLimit(buffer: Buffer, maxBytes: number): Promise<CompressedImage | undefined> {
  try {
    const { Jimp } = await import('jimp');
    const image = await Jimp.read(buffer);
    let quality = 80;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const encoded = await image.getBuffer('image/jpeg', { quality });
      if (encoded.length <= maxBytes) {
        return { data: Buffer.from(encoded), mimeType: 'image/jpeg' };
      }
      const scale = Math.max(0.3, Math.sqrt(maxBytes / encoded.length) * 0.9);
      image.resize({ w: Math.max(64, Math.round(image.width * scale)) });
      quality = Math.max(50, quality - 10);
    }
    return undefined;
  } catch {
    return undefined;
  }
}
