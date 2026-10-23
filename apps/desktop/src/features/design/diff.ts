export type DiffLineType = 'same' | 'add' | 'del';

export interface DiffLine {
  type: DiffLineType;
  /** 1-based line number in `a` (present for 'same' and 'del'). */
  aLine?: number;
  /** 1-based line number in `b` (present for 'same' and 'add'). */
  bLine?: number;
  text: string;
}

export interface LineDiffResult {
  lines: DiffLine[];
  /** True when the input or the output exceeded the line cap and was cut off. */
  truncated: boolean;
}

const DEFAULT_MAX_LINES = 5000;

/** Human-readable byte size ("512 B", "12.3 KB", "1.5 MB") for version UI. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Split into display lines: '' is empty, a trailing newline does not open a line. */
function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Simple LCS line diff. Both sides and the produced output are capped at
 * `maxLines` (default 5000); beyond that the result is truncated and the
 * `truncated` flag is set. The common prefix/suffix is trimmed before the
 * LCS table is built to keep the table small for typical documents.
 */
export function lineDiff(a: string, b: string, maxLines: number = DEFAULT_MAX_LINES): LineDiffResult {
  const aAll = splitLines(a);
  const bAll = splitLines(b);
  let truncated = aAll.length > maxLines || bAll.length > maxLines;
  const aLines = aAll.slice(0, maxLines);
  const bLines = bAll.slice(0, maxLines);

  let start = 0;
  const common = Math.min(aLines.length, bLines.length);
  while (start < common && aLines[start] === bLines[start]) start += 1;
  let endA = aLines.length;
  let endB = bLines.length;
  while (endA > start && endB > start && aLines[endA - 1] === bLines[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const prefix: DiffLine[] = [];
  for (let i = 0; i < start; i += 1) {
    prefix.push({ type: 'same', aLine: i + 1, bLine: i + 1, text: aLines[i] });
  }
  const suffix: DiffLine[] = [];
  for (let i = endA; i < aLines.length; i += 1) {
    suffix.push({
      type: 'same',
      aLine: i + 1,
      bLine: endB + (i - endA) + 1,
      text: aLines[i],
    });
  }

  const lines = [...prefix, ...diffMiddle(aLines, bLines, start, endA, endB), ...suffix];
  if (lines.length > maxLines) {
    lines.length = maxLines;
    truncated = true;
  }
  return { lines, truncated };
}

/** LCS over the differing middle section [start, endA) × [start, endB). */
function diffMiddle(
  aLines: string[],
  bLines: string[],
  start: number,
  endA: number,
  endB: number
): DiffLine[] {
  const a = aLines.slice(start, endA);
  const b = bLines.slice(start, endB);
  const n = a.length;
  const m = b.length;
  if (n === 0) {
    return b.map((text, j) => ({ type: 'add' as const, bLine: start + j + 1, text }));
  }
  if (m === 0) {
    return a.map((text, i) => ({ type: 'del' as const, aLine: start + i + 1, text }));
  }

  // Row-major LCS length table; with the 5000-line cap the worst case is
  // 5001×5001 Uint32 cells (~100 MB), only reachable for fully dissimilar
  // maximum-size inputs.
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = i * width;
    const nextRow = (i + 1) * width;
    for (let j = m - 1; j >= 0; j -= 1) {
      table[row + j] =
        a[i] === b[j]
          ? table[nextRow + j + 1] + 1
          : Math.max(table[nextRow + j], table[row + j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', aLine: start + i + 1, bLine: start + j + 1, text: a[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      out.push({ type: 'del', aLine: start + i + 1, text: a[i] });
      i += 1;
    } else {
      out.push({ type: 'add', bLine: start + j + 1, text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ type: 'del', aLine: start + i + 1, text: a[i] });
    i += 1;
  }
  while (j < m) {
    out.push({ type: 'add', bLine: start + j + 1, text: b[j] });
    j += 1;
  }
  return out;
}
