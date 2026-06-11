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

function firstChangedLine(oldLines: string[], newLines: string[]): number | undefined {
  const max = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < max; index += 1) {
    if (oldLines[index] !== newLines[index]) return index + 1;
  }
  return undefined;
}

function lastChangedIndex(oldLines: string[], newLines: string[]): number {
  let oldIndex = oldLines.length - 1;
  let newIndex = newLines.length - 1;
  while (oldIndex >= 0 && newIndex >= 0 && oldLines[oldIndex] === newLines[newIndex]) {
    oldIndex -= 1;
    newIndex -= 1;
  }
  return Math.max(oldIndex, newIndex);
}

export function buildFileDiff(path: string, oldContent: string, newContent: string): FileDiffResult {
  const oldLines = splitComparableLines(oldContent);
  const newLines = splitComparableLines(newContent);
  const firstChanged = firstChangedLine(oldLines, newLines);
  if (firstChanged === undefined) {
    return {
      diff: '',
      firstChangedLine: undefined,
      structuredPatch: [],
      lineChanges: { additions: 0, deletions: 0, changes: 0 },
    };
  }

  const lines = [`--- ${path}`, `+++ ${path}`, `@@ -1,${oldLines.length} +1,${newLines.length} @@`];
  let additions = 0;
  let deletions = 0;
  const max = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < max; index += 1) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];
    if (oldLine === newLine && oldLine !== undefined) {
      lines.push(` ${oldLine}`);
      continue;
    }
    if (oldLine !== undefined) {
      lines.push(`-${oldLine}`);
      deletions += 1;
    }
    if (newLine !== undefined) {
      lines.push(`+${newLine}`);
      additions += 1;
    }
  }

  const contextLines = 3;
  const firstChangedIndex = firstChanged - 1;
  const lastChanged = lastChangedIndex(oldLines, newLines);
  const hunkStart = Math.max(0, firstChangedIndex - contextLines);
  const hunkEnd = Math.min(max - 1, lastChanged + contextLines);
  const hunkLines: string[] = [];
  for (let index = hunkStart; index <= hunkEnd; index += 1) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];
    if (oldLine === newLine && oldLine !== undefined) {
      hunkLines.push(` ${oldLine}`);
      continue;
    }
    if (oldLine !== undefined) hunkLines.push(`-${oldLine}`);
    if (newLine !== undefined) hunkLines.push(`+${newLine}`);
  }

  return {
    diff: lines.join('\n'),
    firstChangedLine: firstChanged,
    structuredPatch: [{
      oldStart: hunkStart + 1,
      oldLines: oldLines.slice(hunkStart, Math.min(hunkEnd + 1, oldLines.length)).length,
      newStart: hunkStart + 1,
      newLines: newLines.slice(hunkStart, Math.min(hunkEnd + 1, newLines.length)).length,
      lines: hunkLines,
    }],
    lineChanges: {
      additions,
      deletions,
      changes: additions + deletions,
    },
  };
}
