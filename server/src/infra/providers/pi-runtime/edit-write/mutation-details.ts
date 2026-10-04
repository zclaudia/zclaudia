/**
 * Diff budgeting and mutation reporting for the Write/Edit/MultiEdit bridge
 * tools: truncation limits for model-visible and persisted diffs, the
 * budgeted details objects stored on mutation results, and the human-readable
 * mutation result text built from them.
 */

import type { FileDiffHunk, FileDiffResult } from '../diff.js';
import type { MutationStateDescriptor } from '../file-state.js';
import type { WriteDiagnosticsReport, WriteLifecycleDiagnostic } from '../write-lifecycle.js';

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

const MAX_REPORTED_ERRORS = 10;

function errorLines(errors: WriteLifecycleDiagnostic[]): string[] {
  const lines = errors.slice(0, MAX_REPORTED_ERRORS).map(error => {
    const where = [error.path, error.line, error.column].filter(v => v !== undefined).join(':');
    const code = error.code !== undefined ? ` [${error.code}]` : '';
    return `  ${where} ${error.message.split('\n')[0]}${code}`;
  });
  if (errors.length > MAX_REPORTED_ERRORS) {
    lines.push(`  ... and ${errors.length - MAX_REPORTED_ERRORS} more`);
  }
  return lines;
}

function errorCount(count: number, qualifier = ''): string {
  return `${count} ${qualifier}${count === 1 ? 'error' : 'errors'}`;
}

type OtherFiles = NonNullable<WriteDiagnosticsReport['otherFiles']>;

/**
 * "No new errors" says how far the check reached: only the server's open
 * files are re-checked, so an unopened caller can still be broken.
 */
function noNewErrorsLine(label: string, otherFiles: OtherFiles | undefined, scope = ''): string {
  const reach =
    otherFiles && otherFiles.checked > 0
      ? ` (also checked ${otherFiles.checked} other open ${otherFiles.checked === 1 ? 'file' : 'files'})`
      : '';
  return `${label}: no new errors${scope}${reach}.`;
}

function otherFilesLines(label: string, otherFiles: OtherFiles | undefined): string[] {
  if (!otherFiles || otherFiles.errors.length === 0) return [];
  return [
    `${label}: ${errorCount(otherFiles.errors.length)} introduced in other open files:`,
    ...errorLines(otherFiles.errors),
  ];
}

/**
 * Model-facing lines for a language-server check. Every state says what was
 * (not) checked: "not checked" must never be mistaken for "no errors".
 */
export function formatDiagnosticsReport(report: WriteDiagnosticsReport): string[] {
  const label = `Diagnostics (${report.checker})`;
  if (report.state === 'pending') {
    return [
      report.pendingReason === 'starting'
        ? `${label}: not checked, language server still starting.`
        : `${label}: not checked, language server did not answer in time.`,
    ];
  }
  const others = otherFilesLines(label, report.otherFiles);
  if (report.errors.length === 0) {
    return others.length > 0 ? others : [noNewErrorsLine(label, report.otherFiles)];
  }
  const count = report.errors.length;
  const header =
    report.baseline === 'known'
      ? `${label}: ${errorCount(count, 'new ')} introduced by this change:`
      : `${label}: ${errorCount(count)} in this file (may include pre-existing ones):`;
  return [header, ...errorLines(report.errors), ...others];
}

/** One changed file's language-server check, for multi-file mutations. */
export interface FileDiagnosticsReport {
  path: string;
  report: WriteDiagnosticsReport;
}

/** Other-file errors across a multi-file mutation, without duplicates. */
function mergeOtherFiles(entries: FileDiagnosticsReport[]): OtherFiles | undefined {
  const reports = entries.map(entry => entry.report.otherFiles).filter(Boolean) as OtherFiles[];
  if (reports.length === 0) return undefined;
  const changed = new Set(entries.map(entry => entry.path));
  const seen = new Set<string>();
  const errors: WriteLifecycleDiagnostic[] = [];
  for (const error of reports.flatMap(report => report.errors)) {
    const key = [error.path, error.line, error.column, error.code, error.message].join('\0');
    if (changed.has(error.path) || seen.has(key)) continue;
    seen.add(key);
    errors.push(error);
  }
  return { checked: Math.max(...reports.map(report => report.checked)), errors };
}

/**
 * Model-facing lines for a mutation that changed several files: one block per
 * checker, errors across files under a single cap, and the files that went
 * unchecked named explicitly so their silence is not read as "no errors".
 */
export function formatDiagnosticsReports(entries: FileDiagnosticsReport[]): string[] {
  if (entries.length === 0) return [];
  if (entries.length === 1) return formatDiagnosticsReport(entries[0].report);

  const byChecker = new Map<string, FileDiagnosticsReport[]>();
  for (const entry of entries) {
    const group = byChecker.get(entry.report.checker) ?? [];
    group.push(entry);
    byChecker.set(entry.report.checker, group);
  }

  const lines: string[] = [];
  for (const [checker, group] of byChecker) {
    const label = `Diagnostics (${checker})`;
    const checked = group.filter(entry => entry.report.state === 'checked');
    const pending = group.filter(entry => entry.report.state === 'pending');

    if (checked.length > 0) {
      const errors = checked.flatMap(entry => entry.report.errors);
      const otherFiles = mergeOtherFiles(checked);
      const others = otherFilesLines(label, otherFiles);
      if (errors.length === 0) {
        if (others.length > 0) {
          lines.push(...others);
        } else {
          lines.push(
            noNewErrorsLine(
              label,
              otherFiles,
              pending.length === 0 ? '' : ` in ${checked.map(entry => entry.path).join(', ')}`
            )
          );
        }
      } else {
        const baselineKnown = checked.every(
          entry => entry.report.errors.length === 0 || entry.report.baseline === 'known'
        );
        lines.push(
          baselineKnown
            ? `${label}: ${errorCount(errors.length, 'new ')} introduced by this change:`
            : `${label}: ${errorCount(errors.length)} in the changed files (may include pre-existing ones):`,
          ...errorLines(errors),
          ...others
        );
      }
    }

    if (pending.length > 0) {
      const why = pending.some(entry => entry.report.pendingReason === 'starting')
        ? 'language server still starting'
        : 'language server did not answer in time';
      lines.push(
        checked.length === 0
          ? `${label}: not checked, ${why}.`
          : `${label}: not checked for ${pending.map(entry => entry.path).join(', ')}, ${why}.`
      );
    }
  }
  return lines;
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
  diagnostics?: WriteDiagnosticsReport;
  /** Per-file checks of a multi-file mutation; used instead of `diagnostics`. */
  diagnosticsReports?: FileDiagnosticsReport[];
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

  if (input.diagnosticsReports?.length) {
    lines.push(...formatDiagnosticsReports(input.diagnosticsReports));
  } else if (input.diagnostics) {
    lines.push(...formatDiagnosticsReport(input.diagnostics));
  }

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
