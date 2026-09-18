/**
 * Diff budgeting and mutation reporting for the Write/Edit/MultiEdit bridge
 * tools: truncation limits for model-visible and persisted diffs, the
 * budgeted details objects stored on mutation results, and the human-readable
 * mutation result text built from them.
 */

import type { FileDiffHunk, FileDiffResult } from '../diff.js';
import type { MutationStateDescriptor } from '../file-state.js';

const MODEL_VISIBLE_DIFF_MAX_CHARS = 12_000;
const DETAILS_DIFF_MAX_CHARS = 80_000;
const DETAILS_STRUCTURED_PATCH_MAX_LINES = 400;

function truncateForModel(text: string, maxChars = MODEL_VISIBLE_DIFF_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [diff truncated, ${text.length - maxChars} chars omitted]`;
}

export function truncateDiffDetail(diff: string): { diff: string; truncated: boolean } {
  if (diff.length <= DETAILS_DIFF_MAX_CHARS) return { diff, truncated: false };
  return {
    diff: `${diff.slice(0, DETAILS_DIFF_MAX_CHARS)}\n... [diff truncated, ${diff.length - DETAILS_DIFF_MAX_CHARS} chars omitted]`,
    truncated: true,
  };
}

function capStructuredPatchLines(hunks: FileDiffHunk[]): {
  structuredPatch: FileDiffHunk[];
  truncated: boolean;
} {
  let remaining = DETAILS_STRUCTURED_PATCH_MAX_LINES;
  let truncated = false;
  const structuredPatch: FileDiffHunk[] = [];
  for (const hunk of hunks) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (hunk.lines.length <= remaining) {
      structuredPatch.push(hunk);
      remaining -= hunk.lines.length;
      continue;
    }
    structuredPatch.push({ ...hunk, lines: hunk.lines.slice(0, remaining) });
    truncated = true;
    remaining = 0;
  }
  return { structuredPatch, truncated };
}

export function buildBudgetedDiffDetails(diff: FileDiffResult): {
  diff: string;
  structuredPatch: FileDiffHunk[];
  diffTruncated?: boolean;
  structuredPatchTruncated?: boolean;
} {
  const cappedDiff = truncateDiffDetail(diff.diff);
  const cappedPatch = capStructuredPatchLines(diff.structuredPatch);
  return {
    diff: cappedDiff.diff,
    structuredPatch: cappedPatch.structuredPatch,
    ...(cappedDiff.truncated ? { diffTruncated: true } : {}),
    ...(cappedPatch.truncated ? { structuredPatchTruncated: true } : {}),
  };
}

export function buildMutationDetailsBase(input: {
  ok?: true;
  path: string;
  diff: FileDiffResult;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  const diffDetails = buildBudgetedDiffDetails(input.diff);
  // Deliberately no full before/after content here: the diff + snapshot state
  // carry everything consumers use, and two file bodies per edit bloat every
  // persisted tool_call_record (~50KB each on a mid-sized file).
  return {
    ok: input.ok ?? true,
    path: input.path,
    ...(input.extra ?? {}),
    diff: diffDetails.diff,
    firstChangedLine: input.diff.firstChangedLine,
    structuredPatch: diffDetails.structuredPatch,
    lineChanges: input.diff.lineChanges,
    ...(diffDetails.diffTruncated ? { diffTruncated: true } : {}),
    ...(diffDetails.structuredPatchTruncated ? { structuredPatchTruncated: true } : {}),
  };
}

function formatLineChanges(lineChanges: unknown): string | undefined {
  if (!lineChanges || typeof lineChanges !== 'object') return undefined;
  const changes = lineChanges as { additions?: unknown; deletions?: unknown; changes?: unknown };
  if (typeof changes.additions !== 'number' || typeof changes.deletions !== 'number')
    return undefined;
  const total = typeof changes.changes === 'number' ? `, ${changes.changes} changed` : '';
  return `+${changes.additions} -${changes.deletions}${total}`;
}

function formatFirstChangedLine(value: unknown): string | undefined {
  return typeof value === 'number' ? String(value) : undefined;
}

function formatMutationStateLine(state: MutationStateDescriptor | undefined): string | undefined {
  if (!state) return undefined;
  const ranges =
    state.changedRanges.length > 0
      ? state.changedRanges.map(range => `${range.start}-${range.end}`).join(',')
      : 'none';
  const previous = state.previousSnapshotId ?? 'new-file';
  const rebase = state.rebased ? ' rebased=true;' : '';
  return `State:${rebase} previousSnapshotId=${previous} newSnapshotId=${state.newSnapshotId} changedRanges=${ranges}.`;
}

function formatPerFileResults(perFileResults: unknown): string[] {
  if (!Array.isArray(perFileResults) || perFileResults.length === 0) return [];
  return perFileResults.map((raw, index) => {
    const result = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const pathValue = typeof result.path === 'string' ? result.path : `operation ${index + 1}`;
    if (result.ok === false) {
      const error = typeof result.error === 'string' ? result.error : 'failed';
      const message = typeof result.message === 'string' ? `: ${result.message}` : '';
      return `- ${pathValue}: failed (${error})${message}`;
    }
    if (result.type === 'rename') {
      const originalPath =
        typeof result.originalPath === 'string' ? result.originalPath : pathValue;
      return `- rename ${originalPath} -> ${pathValue}`;
    }
    const type = typeof result.type === 'string' ? result.type : 'update';
    const firstChanged = formatFirstChangedLine(result.firstChangedLine);
    const changes = formatLineChanges(result.lineChanges);
    return [`- ${type} ${pathValue}`, firstChanged ? `line ${firstChanged}` : undefined, changes]
      .filter(Boolean)
      .join(' ');
  });
}

export function buildMutationResultText(input: {
  action: string;
  path?: string;
  type?: string;
  preview?: boolean;
  replaced?: number;
  editCount?: number;
  fileCount?: number;
  firstChangedLine?: unknown;
  lineChanges?: unknown;
  diff?: string;
  perFileResults?: unknown;
  snapshotUpdated?: boolean;
  state?: MutationStateDescriptor;
  rebased?: boolean;
}): string {
  const headlineParts = [input.action];
  if (input.path) headlineParts.push(input.path);
  if (input.type) headlineParts.push(`(${input.type})`);

  const lines = [headlineParts.join(' ')];
  if (typeof input.fileCount === 'number') lines.push(`Files changed: ${input.fileCount}`);
  if (typeof input.editCount === 'number') lines.push(`Edits applied: ${input.editCount}`);
  if (typeof input.replaced === 'number') lines.push(`Replacements: ${input.replaced}`);

  const firstChanged = formatFirstChangedLine(input.firstChangedLine);
  if (firstChanged) lines.push(`First changed line: ${firstChanged}`);

  const changes = formatLineChanges(input.lineChanges);
  if (changes) lines.push(`Line changes: ${changes}`);

  if (input.rebased) {
    lines.push(
      'Rebased: file changed since the last Read, but each requested replacement still matched current content uniquely.'
    );
  }

  const stateLine = formatMutationStateLine(input.state);
  if (stateLine) lines.push(stateLine);

  const perFileLines = formatPerFileResults(input.perFileResults);
  if (perFileLines.length > 0) lines.push('Files:', ...perFileLines);

  if (input.preview) {
    lines.push('Disk: not modified (preview_only:true).');
  } else if (input.snapshotUpdated !== false) {
    lines.push(
      'Result: mutation is reflected in the diff below; do not call Read again only to verify it.'
    );
    lines.push('Snapshot: internal file state updated for subsequent Edit/Write calls.');
  } else if (!input.action.toLowerCase().includes('failed')) {
    lines.push(
      'Result: mutation is reflected in the diff below; do not call Read again only to verify it.'
    );
  }

  const diff = typeof input.diff === 'string' ? input.diff.trim() : '';
  lines.push(diff ? `Diff:\n${truncateForModel(diff)}` : 'Diff: (no textual changes)');
  return lines.join('\n');
}
