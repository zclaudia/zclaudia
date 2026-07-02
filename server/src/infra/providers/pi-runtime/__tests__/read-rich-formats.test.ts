import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { Jimp } from 'jimp';
import { buildTools } from '../tool-bridge.js';
import { renderNotebook, parsePageSpec } from '../rich-read.js';

function readTool(dir: string, options: Record<string, unknown> = {}): any {
  return buildTools(dir, { enabled: ['Read'], ...options }).find((t: any) => t.name === 'Read');
}

const NOTEBOOK = JSON.stringify({
  cells: [
    { cell_type: 'markdown', source: ['# Analysis\n', 'Some context.'] },
    {
      cell_type: 'code',
      execution_count: 2,
      source: 'print("hello")\n1 + 1',
      outputs: [
        { output_type: 'stream', name: 'stdout', text: ['hello\n'] },
        { output_type: 'execute_result', data: { 'text/plain': ['2'], 'image/png': 'AAAA' } },
      ],
    },
    {
      cell_type: 'code',
      source: ['raise ValueError("nope")'],
      outputs: [{ output_type: 'error', ename: 'ValueError', evalue: 'nope', traceback: ['...'] }],
    },
  ],
  metadata: { kernelspec: { language: 'python' } },
  nbformat: 4,
});

describe('renderNotebook', () => {
  it('renders markdown and code cells with outputs', () => {
    const text = renderNotebook(NOTEBOOK);
    expect(text).toContain('# Analysis');
    expect(text).toContain('print("hello")');
    expect(text).toContain('hello');
    expect(text).toContain('2');
    expect(text).toContain('ValueError: nope');
    expect(text).toContain('[image output omitted]');
    expect(text).toMatch(/Cell 2/);
  });

  it('throws on non-notebook JSON', () => {
    expect(() => renderNotebook('{"not": "a notebook"}')).toThrow();
  });
});

describe('parsePageSpec', () => {
  it('parses ranges and singles', () => {
    expect(parsePageSpec('1-3,5', 10)).toEqual([1, 2, 3, 5]);
    expect(parsePageSpec('2', 10)).toEqual([2]);
    expect(parsePageSpec(undefined, 3)).toEqual([1, 2, 3]);
  });

  it('clamps to the document and caps the page count', () => {
    expect(parsePageSpec('1-100', 5)).toEqual([1, 2, 3, 4, 5]);
    expect(parsePageSpec(undefined, 50)).toHaveLength(20);
  });
});

describe('Read .ipynb integration', () => {
  it('returns rendered cells through the normal pagination path', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-readnb-'));
    writeFileSync(path.join(dir, 'analysis.ipynb'), NOTEBOOK);
    const res = await readTool(dir).execute('r1', { path: 'analysis.ipynb' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.format).toBe('notebook');
    expect(res.content[0].text).toContain('print("hello")');
  });
});

const MINIMAL_PDF = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 60 >> stream
BT /F1 24 Tf 100 700 Td (Hello PDF extraction) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R /Size 6 >>
%%EOF`;

describe('Read .pdf integration', () => {
  it('extracts text per page with page markers', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-readpdf-'));
    writeFileSync(path.join(dir, 'doc.pdf'), MINIMAL_PDF);
    const res = await readTool(dir).execute('r1', { path: 'doc.pdf' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.format).toBe('pdf');
    expect(res.details.totalPages).toBe(1);
    expect(res.content[0].text).toContain('Hello PDF extraction');
    expect(res.content[0].text).toContain('Page 1 of 1');
  });
});

describe('Read oversized image compression', () => {
  it('downscales an image above the vision limit instead of rejecting it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-readimg-'));
    // Random noise compresses poorly — reliably lands above 5MB as PNG.
    const image = new Jimp({ width: 1600, height: 1600 });
    for (let y = 0; y < 1600; y += 1) {
      for (let x = 0; x < 1600; x += 1) {
        image.setPixelColor(((((Math.random() * 0xffffff) | 0) << 8) | 0xff) >>> 0, x, y);
      }
    }
    const buffer = await image.getBuffer('image/png');
    expect(buffer.length).toBeGreaterThan(5 * 1024 * 1024);
    writeFileSync(path.join(dir, 'big.png'), buffer);

    const res = await readTool(dir, { supportsVision: true }).execute('r1', { path: 'big.png' });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.resized).toBe(true);
    expect(res.content[0].type).toBe('image');
    expect(Buffer.from(res.content[0].data, 'base64').length).toBeLessThanOrEqual(5 * 1024 * 1024);
  }, 60000);
});
