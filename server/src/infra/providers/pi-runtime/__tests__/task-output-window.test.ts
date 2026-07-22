import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { readTaskLogWindow } from '../task-output-window.js';

const CAP = 50 * 1024;

/** Builds a log of `count` lines, each exactly 100 bytes including the newline. */
function buildNumberedLog(count: number): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i += 1) {
    // 'line ' (5) + 6 digits + ' ' (1) + 87 fill + '\n' (1) = 100 bytes
    lines.push(`line ${i.toString().padStart(6, '0')} ${'x'.repeat(87)}`);
  }
  return lines.join('\n') + '\n';
}

describe('readTaskLogWindow', () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'zc-taskwin-'));
    logPath = path.join(dir, 'task.log');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('pages a >50KB log via nextOffset without skipping the middle (P1-6)', () => {
    // 1_200 lines x 100 bytes = 120_000 bytes > 2 pages of the 50 KiB cap.
    writeFileSync(logPath, buildNumberedLog(1_200));
    const size = 120_000;

    const page1 = readTaskLogWindow(logPath, {});
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.size).toBe(size);
    expect(Buffer.byteLength(page1.output, 'utf8')).toBe(CAP);
    expect(page1.truncated).toBe(true);
    expect(page1.eof).toBe(false);
    // The regression: nextOffset must resume where this page stopped, not EOF.
    expect(page1.nextOffset).toBe(CAP);
    expect(page1.nextOffset).not.toBe(size);
    expect(page1.output.startsWith('line 000000')).toBe(true);
    expect(page1.output).toContain('line 000511');

    const page2 = readTaskLogWindow(logPath, { output_offset: page1.nextOffset });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.output.startsWith('line 000512')).toBe(true);
    expect(Buffer.byteLength(page2.output, 'utf8')).toBe(CAP);
    expect(page2.nextOffset).toBe(2 * CAP);
    expect(page2.eof).toBe(false);
    expect(page2.truncated).toBe(true);

    const page3 = readTaskLogWindow(logPath, { output_offset: page2.nextOffset });
    expect(page3.ok).toBe(true);
    if (!page3.ok) return;
    expect(page3.output.startsWith('line 001024')).toBe(true);
    expect(page3.nextOffset).toBe(size);
    expect(page3.eof).toBe(true);
    expect(page3.truncated).toBe(false);

    // Byte-exact reassembly: the three windows cover the whole log with no
    // gap and no overlap — a follow-up read from "previous nextOffset" (per
    // the TaskOutput schema contract) never skips content.
    const raw = readFileSync(logPath);
    expect(raw.subarray(0, page1.nextOffset).toString('utf8')).toBe(page1.output);
    expect(raw.subarray(page1.nextOffset, page2.nextOffset).toString('utf8')).toBe(page2.output);
    expect(raw.subarray(page2.nextOffset, page3.nextOffset).toString('utf8')).toBe(page3.output);
    expect(page3.nextOffset).toBe(raw.length);
  });

  it('reports eof/nextOffset at end-of-log for a small log read in one page', () => {
    writeFileSync(logPath, buildNumberedLog(10)); // 1_000 bytes < cap
    const result = readTaskLogWindow(logPath, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.size).toBe(1_000);
    expect(result.eof).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.nextOffset).toBe(1_000);
    expect(result.output.startsWith('line 000000')).toBe(true);
    expect(result.output).toContain('line 000009');
  });

  it('clamps an output_offset past end-of-log instead of erroring', () => {
    writeFileSync(logPath, buildNumberedLog(10));
    const result = readTaskLogWindow(logPath, { output_offset: 999_999 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toBe('');
    expect(result.eof).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.nextOffset).toBe(1_000);
  });

  it('returns an empty eof window when the log does not exist yet', () => {
    const missing = path.join(dir, 'no-such.log');
    const result = readTaskLogWindow(missing, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toBe('');
    expect(result.size).toBe(0);
    expect(result.nextOffset).toBe(0);
    expect(result.eof).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it('tail_lines returns the last N lines, is always eof, and keeps nextOffset at size', () => {
    writeFileSync(logPath, buildNumberedLog(10));
    const result = readTaskLogWindow(logPath, { tail_lines: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toContain('line 000007');
    expect(result.output).toContain('line 000009');
    expect(result.output).not.toContain('line 000006');
    expect(result.eof).toBe(true);
    expect(result.truncated).toBe(true); // 10 lines on disk > 3 returned
    // Tail-mode semantics are unchanged by P1-6: nextOffset stays at EOF.
    expect(result.nextOffset).toBe(1_000);
  });

  it('tail_lines larger than the log returns everything untruncated', () => {
    writeFileSync(logPath, buildNumberedLog(2));
    const result = readTaskLogWindow(logPath, { tail_lines: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output).toContain('line 000000');
    expect(result.output).toContain('line 000001');
    expect(result.truncated).toBe(false);
    expect(result.eof).toBe(true);
  });

  it('rejects invalid window params with structured errors', () => {
    writeFileSync(logPath, 'x\n');
    expect(readTaskLogWindow(logPath, { output_offset: -1 })).toMatchObject({
      ok: false,
      code: 'invalid_output_offset',
    });
    expect(readTaskLogWindow(logPath, { output_offset: 1.5 })).toMatchObject({
      ok: false,
      code: 'invalid_output_offset',
    });
    expect(readTaskLogWindow(logPath, { tail_lines: 0 })).toMatchObject({
      ok: false,
      code: 'invalid_tail_lines',
    });
    expect(readTaskLogWindow(logPath, { tail_lines: 2_001 })).toMatchObject({
      ok: false,
      code: 'invalid_tail_lines',
    });
  });
});
