export interface FileDiffResult {
  diff: string;
  firstChangedLine?: number;
  structuredPatch: FileDiffHunk[];
  lineChanges: FileLineChanges;
}

export interface FileDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FileLineChanges {
  additions: number;
  deletions: number;
  changes: number;
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function splitComparableLines(text: string): string[] {
  text = normalizeLineEndings(text);
  if (text.length === 0) return [];
  const withoutFinalNewline = text.endsWith('\n') ? text.slice(0, -1) : text;
  return withoutFinalNewline.length === 0 ? [] : withoutFinalNewline.split('\n');
}

const CONTEXT_LINES = 3;
// Above this many DP cells the O(n*m) LCS is too costly. Because we trim the
// common prefix/suffix first, we only reach this when a large region genuinely
// differs throughout — then we fall back to a coarse "replace the whole middle"
// diff (correct, just not minimal). 4M ≈ a 2000x2000 changed region.
const MAX_LCS_CELLS = 4_000_000;

type DiffOp = { type: 'eq' | 'del' | 'ins'; text: string };

/**
 * LCS line alignment of the differing middle (common prefix/suffix already
 * trimmed by the caller). Produces a minimal eq/del/ins op sequence so that
 * unchanged lines interleaved with changes stay as context rather than being
 * re-emitted as delete+insert.
 */
function diffMiddle(oldMid: string[], newMid: string[]): DiffOp[] {
  if (oldMid.length === 0) return newMid.map((text) => ({ type: 'ins', text }));
  if (newMid.length === 0) return oldMid.map((text) => ({ type: 'del', text }));
  if (oldMid.length * newMid.length > MAX_LCS_CELLS) {
    return [
      ...oldMid.map((text): DiffOp => ({ type: 'del', text })),
      ...newMid.map((text): DiffOp => ({ type: 'ins', text })),
    ];
  }
  const m = oldMid.length;
  const n = newMid.length;
  const width = n + 1;
  // dp[i][j] = LCS length of oldMid[i..] and newMid[j..].
  const dp = new Int32Array((m + 1) * width);
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i * width + j] = oldMid[i] === newMid[j]
        ? dp[(i + 1) * width + (j + 1)] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldMid[i] === newMid[j]) { ops.push({ type: 'eq', text: oldMid[i] }); i += 1; j += 1; }
    else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) { ops.push({ type: 'del', text: oldMid[i] }); i += 1; }
    else { ops.push({ type: 'ins', text: newMid[j] }); j += 1; }
  }
  while (i < m) { ops.push({ type: 'del', text: oldMid[i] }); i += 1; }
  while (j < n) { ops.push({ type: 'ins', text: newMid[j] }); j += 1; }
  return ops;
}

/** Full eq/del/ins op sequence over the two files (common prefix/suffix kept as eq). */
function diffLines(oldLines: string[], newLines: string[]): DiffOp[] {
  let p = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (p < minLen && oldLines[p] === newLines[p]) p += 1;
  let s = 0;
  while (
    s < oldLines.length - p
    && s < newLines.length - p
    && oldLines[oldLines.length - 1 - s] === newLines[newLines.length - 1 - s]
  ) s += 1;

  const ops: DiffOp[] = [];
  for (let k = 0; k < p; k += 1) ops.push({ type: 'eq', text: oldLines[k] });
  ops.push(...diffMiddle(oldLines.slice(p, oldLines.length - s), newLines.slice(p, newLines.length - s)));
  for (let k = oldLines.length - s; k < oldLines.length; k += 1) ops.push({ type: 'eq', text: oldLines[k] });
  return ops;
}

interface AnnotatedOp extends DiffOp {
  oldNo: number;
  newNo: number;
}

export function buildFileDiff(path: string, oldContent: string, newContent: string): FileDiffResult {
  const oldLines = splitComparableLines(oldContent);
  const newLines = splitComparableLines(newContent);
  const ops = diffLines(oldLines, newLines);

  // Annotate each op with its 1-based old/new line number and tally changes.
  const anno: AnnotatedOp[] = [];
  let oldNo = 1;
  let newNo = 1;
  let additions = 0;
  let deletions = 0;
  let firstChangedLine: number | undefined;
  for (const op of ops) {
    if (op.type === 'eq') {
      anno.push({ ...op, oldNo, newNo });
      oldNo += 1;
      newNo += 1;
    } else if (op.type === 'del') {
      if (firstChangedLine === undefined) firstChangedLine = oldNo;
      anno.push({ ...op, oldNo, newNo });
      oldNo += 1;
      deletions += 1;
    } else {
      if (firstChangedLine === undefined) firstChangedLine = oldNo;
      anno.push({ ...op, oldNo, newNo });
      newNo += 1;
      additions += 1;
    }
  }

  if (additions === 0 && deletions === 0) {
    return {
      diff: '',
      firstChangedLine: undefined,
      structuredPatch: [],
      lineChanges: { additions: 0, deletions: 0, changes: 0 },
    };
  }

  // Group changes into hunks: each change carries up to CONTEXT_LINES of context
  // on either side; adjacent hunks that would touch are merged. This keeps the
  // diff localized — a change at line 48 no longer drags the rest of the file in.
  const ranges: Array<{ start: number; end: number }> = [];
  for (let idx = 0; idx < anno.length; idx += 1) {
    if (anno[idx].type === 'eq') continue;
    const lo = Math.max(0, idx - CONTEXT_LINES);
    const hi = Math.min(anno.length - 1, idx + CONTEXT_LINES);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last.end + 1) last.end = Math.max(last.end, hi);
    else ranges.push({ start: lo, end: hi });
  }

  const structuredPatch: FileDiffHunk[] = [];
  const diffOut: string[] = [`--- ${path}`, `+++ ${path}`];
  for (const range of ranges) {
    const slice = anno.slice(range.start, range.end + 1);
    let oldCount = 0;
    let newCount = 0;
    const hunkLines: string[] = [];
    for (const op of slice) {
      if (op.type === 'eq') { hunkLines.push(` ${op.text}`); oldCount += 1; newCount += 1; }
      else if (op.type === 'del') { hunkLines.push(`-${op.text}`); oldCount += 1; }
      else { hunkLines.push(`+${op.text}`); newCount += 1; }
    }
    const oldStart = slice[0].oldNo;
    const newStart = slice[0].newNo;
    structuredPatch.push({ oldStart, oldLines: oldCount, newStart, newLines: newCount, lines: hunkLines });
    diffOut.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...hunkLines);
  }

  return {
    diff: diffOut.join('\n'),
    firstChangedLine,
    structuredPatch,
    lineChanges: { additions, deletions, changes: additions + deletions },
  };
}
