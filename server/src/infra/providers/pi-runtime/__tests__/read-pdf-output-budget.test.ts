import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { createReadBridgeTool } from '../read-tool.js';

vi.mock('unpdf', () => ({
  extractText: vi.fn(async () => ({
    totalPages: 1,
    text: [`${'pdf line\n'.repeat(40_000)}`],
  })),
}));

describe('Read .pdf output budget', () => {
  it('caps extracted PDF text to the Read output budget', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-readpdf-budget-'));
    writeFileSync(path.join(dir, 'doc.pdf'), '%PDF-1.4\n%%EOF');
    const read = createReadBridgeTool(dir) as any;

    const result = await read.execute('read-pdf-budget', { path: 'doc.pdf' });

    rmSync(dir, { recursive: true, force: true });
    expect(result.details).toMatchObject({ ok: true, format: 'pdf', cappedByTokens: true });
    expect(result.content[0].text.length).toBeLessThan(120_000);
    expect(result.content[0].text).toContain('output capped at ~25000 tokens');
  });
});
