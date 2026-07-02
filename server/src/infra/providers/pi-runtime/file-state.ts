import { createHash } from 'crypto';

import type { FileDiffResult, FileDiffHunk } from './diff.js';
import { hashlineSnapshotId, hashlineTag } from './hashline.js';

export interface SnapshotDescriptor {
  snapshotId: string;
  tag: string;
  fileDigest: string;
}

export interface RangeDescriptor {
  start: number;
  end: number;
  rangeDigest: string;
}

export interface ReadStateDescriptor extends SnapshotDescriptor {
  fullContentCaptured: boolean;
  partialView: boolean;
  range?: RangeDescriptor;
  ranges?: RangeDescriptor[];
}

export interface PartialReadStateDescriptor {
  fullContentCaptured: false;
  partialView: true;
  streamed?: boolean;
  range?: RangeDescriptor;
}

export interface MutationStateDescriptor {
  previousSnapshotId: string | null;
  newSnapshotId: string;
  previousFileDigest: string | null;
  newFileDigest: string;
  changedRanges: RangeDescriptor[];
  snapshotUpdated: boolean;
  readSnapshotId?: string;
  readFileDigest?: string;
  rebased?: boolean;
}

export interface FileStateErrorDescriptor {
  currentSnapshotId?: string;
  currentFileDigest?: string;
  readSnapshotId?: string;
  readFileDigest?: string;
  hasFullContent?: boolean;
  partialView?: boolean;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function normalizeSnapshotContent(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

export function fileDigest(content: string): string {
  return `sha256:${sha256(normalizeSnapshotContent(content))}`;
}

export function rangeDigest(lines: string[]): string {
  return `sha256:${sha256(lines.join('\n'))}`;
}

export function splitSnapshotLines(content: string): string[] {
  const normalized = normalizeSnapshotContent(content);
  if (!normalized) return [];
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return trimmed ? trimmed.split('\n') : [];
}

export function buildSnapshotDescriptor(relPath: string, content: string): SnapshotDescriptor {
  return {
    snapshotId: hashlineSnapshotId(relPath, content),
    tag: hashlineTag(content),
    fileDigest: fileDigest(content),
  };
}

export function buildRangeDescriptor(start: number, lines: string[]): RangeDescriptor {
  const safeStart = Math.max(1, start);
  return {
    start: safeStart,
    end: lines.length > 0 ? safeStart + lines.length - 1 : safeStart - 1,
    rangeDigest: rangeDigest(lines),
  };
}

export function buildReadStateDescriptor(input: {
  relPath: string;
  content: string;
  range?: RangeDescriptor;
  ranges?: RangeDescriptor[];
  fullContentCaptured: boolean;
  partialView: boolean;
}): ReadStateDescriptor {
  return {
    ...buildSnapshotDescriptor(input.relPath, input.content),
    fullContentCaptured: input.fullContentCaptured,
    partialView: input.partialView,
    ...(input.range ? { range: input.range } : {}),
    ...(input.ranges ? { ranges: input.ranges } : {}),
  };
}

export function buildPartialReadStateDescriptor(input: {
  start: number;
  lines: string[];
  streamed?: boolean;
}): PartialReadStateDescriptor {
  return {
    fullContentCaptured: false,
    partialView: true,
    ...(input.streamed !== undefined ? { streamed: input.streamed } : {}),
    range: buildRangeDescriptor(input.start, input.lines),
  };
}

function changedRangeFromHunk(hunk: FileDiffHunk): { start: number; end: number } | undefined {
  let newLine = hunk.newStart;
  let start: number | undefined;
  let end: number | undefined;
  for (const line of hunk.lines) {
    const prefix = line[0];
    if (prefix === ' ') {
      newLine += 1;
      continue;
    }
    if (prefix === '+') {
      start ??= newLine;
      end = newLine;
      newLine += 1;
      continue;
    }
    if (prefix === '-') {
      start ??= newLine;
      end = Math.max(end ?? newLine, newLine);
    }
  }
  if (start === undefined || end === undefined) return undefined;
  return { start, end };
}

export function changedRangesFromDiff(
  diff: FileDiffResult,
  updatedContent: string
): RangeDescriptor[] {
  const updatedLines = splitSnapshotLines(updatedContent);
  return diff.structuredPatch
    .map(changedRangeFromHunk)
    .filter((range): range is { start: number; end: number } => Boolean(range))
    .map(range => {
      if (updatedLines.length === 0) return buildRangeDescriptor(1, []);
      const start = Math.min(Math.max(1, range.start), updatedLines.length);
      const end = Math.min(Math.max(start, range.end), updatedLines.length);
      return buildRangeDescriptor(start, updatedLines.slice(start - 1, end));
    });
}

export function buildMutationStateDescriptor(input: {
  relPath: string;
  originalContent: string | null;
  updatedContent: string;
  diff: FileDiffResult;
  snapshotUpdated: boolean;
  readSnapshotContent?: string;
  rebased?: boolean;
}): MutationStateDescriptor {
  const next = buildSnapshotDescriptor(input.relPath, input.updatedContent);
  const previous =
    input.originalContent === null
      ? undefined
      : buildSnapshotDescriptor(input.relPath, input.originalContent);
  const readSnapshot =
    input.readSnapshotContent === undefined
      ? undefined
      : buildSnapshotDescriptor(input.relPath, input.readSnapshotContent);
  return {
    previousSnapshotId: previous?.snapshotId ?? null,
    newSnapshotId: next.snapshotId,
    previousFileDigest: previous?.fileDigest ?? null,
    newFileDigest: next.fileDigest,
    changedRanges: changedRangesFromDiff(input.diff, input.updatedContent),
    snapshotUpdated: input.snapshotUpdated,
    ...(readSnapshot
      ? { readSnapshotId: readSnapshot.snapshotId, readFileDigest: readSnapshot.fileDigest }
      : {}),
    ...(input.rebased ? { rebased: true } : {}),
  };
}

export function buildFileStateErrorDescriptor(input: {
  relPath: string;
  currentContent?: string;
  readContent?: string;
  hasFullContent?: boolean;
  partialView?: boolean;
}): FileStateErrorDescriptor {
  const current =
    input.currentContent === undefined
      ? undefined
      : buildSnapshotDescriptor(input.relPath, input.currentContent);
  const read =
    input.readContent === undefined
      ? undefined
      : buildSnapshotDescriptor(input.relPath, input.readContent);
  return {
    ...(current
      ? { currentSnapshotId: current.snapshotId, currentFileDigest: current.fileDigest }
      : {}),
    ...(read ? { readSnapshotId: read.snapshotId, readFileDigest: read.fileDigest } : {}),
    ...(input.hasFullContent !== undefined ? { hasFullContent: input.hasFullContent } : {}),
    ...(input.partialView !== undefined ? { partialView: input.partialView } : {}),
  };
}
