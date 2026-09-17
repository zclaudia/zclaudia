/**
 * Shared plumbing for the Write/Edit/MultiEdit bridge tools: result
 * scaffolding, guard helpers (read-state, content, rebase anchors), the
 * symlink-aware write-path resolution, batch-edit parsing, and multi-file
 * write locking. Diff budgeting and mutation details/result text live in
 * mutation-details.ts; the tools themselves live in write-tool.ts,
 * edit-tool.ts, and multi-edit-tool.ts.
 */

import type { AgentTool } from '@earendil-works/pi-agent-core';
import { lstat, realpath } from 'fs/promises';
import * as path from 'path';

import { countOccurrences, findActualString } from '../edit-match.js';
import type { ReadFileStateEntry, ReadFileStateStore } from '../read-file-state.js';
import { buildFileStateErrorDescriptor } from '../file-state.js';
import { runWithFileWriteLock } from '../file-write-lock.js';
import type { NoopEditGuard } from '../noop-edit-guard.js';
import { validateMutationContent } from '../write-guards.js';
import type {
  DiagnosticsMode,
  WriteDiagnosticsProvider,
  WriteLifecycleHooks,
} from '../write-lifecycle.js';
import { isOutsideWorkspace } from '../workspace-paths.js';

export type TextBlock = { type: 'text'; text: string };
export type ToolContent = TextBlock[];
export type BatchEditInput = { oldString: string; newString: string; replaceAll: boolean };
export type FileMutationTool = AgentTool;
export type FileMutationToolResult = Awaited<ReturnType<FileMutationTool['execute']>>;
export type FileMutationToolUpdate = Parameters<FileMutationTool['execute']>[3];
export type MutationDetails = Record<string, unknown>;

export interface FileMutationToolOptions {
  readFileState?: ReadFileStateStore;
  writeLifecycle?: WriteLifecycleHooks;
  diagnosticsProvider?: WriteDiagnosticsProvider;
  diagnosticsMode?: DiagnosticsMode;
  /** Shared per-run guard against repeated identical failed/no-op edits. */
  noopGuard?: NoopEditGuard;
}

export function textResult<TDetails extends Record<string, unknown> = Record<string, never>>(
  text: string,
  details?: TDetails
): { content: ToolContent; details: TDetails | Record<string, never> } {
  return { content: [{ type: 'text', text }], details: details ?? {} };
}

export function errorResult(
  code: string,
  message: string,
  details: Record<string, unknown> = {}
): { content: ToolContent; details: Record<string, unknown> } {
  return textResult(message, { ok: false, error: code, message, ...details });
}

export function resultDetails(result: FileMutationToolResult): MutationDetails {
  const details = result.details as unknown;
  return details && typeof details === 'object' ? (details as MutationDetails) : {};
}

// The workspace-relative path of the first failed operation in a patch
// preflight result, when one is reported (top-level for single-op failures,
// otherwise the first failing per-file entry).
export function firstPatchFailurePath(details: MutationDetails): string | undefined {
  if (typeof details.path === 'string') return details.path;
  if (!Array.isArray(details.perFileResults)) return undefined;
  for (const entry of details.perFileResults) {
    const record = entry && typeof entry === 'object' ? (entry as MutationDetails) : undefined;
    if (record?.ok === false && typeof record.path === 'string') return record.path;
  }
  return undefined;
}

export function guardErrorDetails(
  guard: ReturnType<typeof validateMutationContent>,
  details: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...details,
    ...(guard?.details ?? {}),
  };
}

export function validateUpdatedContent(
  filePath: string,
  content: string,
  details: Record<string, unknown> = {}
): { ok: true } | { ok: false; result: ReturnType<typeof errorResult> } {
  const guard = validateMutationContent(filePath, content);
  if (!guard) return { ok: true };
  return {
    ok: false,
    result: errorResult(guard.code, guard.message, guardErrorDetails(guard, details)),
  };
}

function suggestedActionForReadGuard(code: string): string {
  switch (code) {
    case 'file_not_read':
      return 'read_file';
    case 'partial_read':
      return 'read_full_file';
    case 'file_modified_since_read':
      return 'refresh_snapshot';
    default:
      return 'inspect_file_state';
  }
}

export function readGuardFailureDetails(input: {
  code: string;
  relPath: string;
  currentContent?: string;
  readEntry?: ReadFileStateEntry;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    path: input.relPath,
    retryable: true,
    suggestedAction: suggestedActionForReadGuard(input.code),
    state: buildFileStateErrorDescriptor({
      relPath: input.relPath,
      currentContent: input.currentContent,
      readContent: input.readEntry?.content,
      hasFullContent: input.readEntry?.hasFullContent,
      partialView: input.readEntry?.isPartialView,
    }),
    ...(input.extra ?? {}),
  };
}

export function assertRebaseAnchorsWereRead(
  readContent: string | undefined,
  edits: BatchEditInput[]
): { ok: true } | { ok: false; code: string; message: string; details: Record<string, unknown> } {
  if (readContent === undefined) {
    return {
      ok: false,
      code: 'missing_read_snapshot',
      message: 'Cannot rebase because no previous read snapshot is available.',
      details: {},
    };
  }
  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index];
    const actual = findActualString(readContent, edit.oldString);
    if (actual === null) {
      return {
        ok: false,
        code: 'not_found_in_read_snapshot',
        message: `edits[${index}].old_string was not present in the last Read snapshot.`,
        details: { editIndex: index },
      };
    }
    const occurrences = countOccurrences(readContent, actual);
    if (!edit.replaceAll && occurrences > 1) {
      return {
        ok: false,
        code: 'not_unique_in_read_snapshot',
        message: `edits[${index}].old_string appeared ${occurrences} times in the last Read snapshot.`,
        details: { editIndex: index, occurrences },
      };
    }
  }
  return { ok: true };
}

export function toolParams(first: unknown, second: unknown): Record<string, unknown> {
  const candidate = second ?? first;
  return candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>) : {};
}

// Resolves the path that mutations should actually write through. For a regular
// file (or a not-yet-existing path) that's the path itself. For a symlink we
// follow it to its real target and write THROUGH the link — replacing the
// target's content via the usual temp+rename — instead of clobbering the link.
// Reads/stat already follow symlinks transparently, so the rest of the flow
// (snapshot, guards, backups) stays keyed on the original path. A symlink whose
// target escapes the workspace, or a broken link with no resolvable target, is
// refused: those are the cases where blindly following would be unsafe.
export async function resolveWritePath(
  cwd: string,
  filePath: string,
  relPath: string
): Promise<
  | { ok: true; writePath: string; wasSymlink: boolean }
  | { ok: false; result: ReturnType<typeof errorResult> }
> {
  let linkStat;
  try {
    linkStat = await lstat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT')
      return { ok: true, writePath: filePath, wasSymlink: false };
    throw err;
  }
  if (!linkStat.isSymbolicLink()) return { ok: true, writePath: filePath, wasSymlink: false };
  let target: string;
  try {
    target = await realpath(filePath);
  } catch {
    return {
      ok: false,
      result: errorResult(
        'broken_symlink',
        `Refusing to write through broken symlink: ${relPath}`,
        { path: relPath }
      ),
    };
  }
  // Compare the resolved target against the resolved workspace root, both
  // canonicalised, so symlinked workspace roots (macOS /tmp -> /private/tmp)
  // don't read as escapes. resolveInsideWorkspace can't be reused here: its fast
  // path compares an absolute argument against the raw, non-canonical cwd.
  const realWorkspace = await realpath(cwd).catch(() => path.resolve(cwd));
  const relToWorkspace = path.relative(realWorkspace, target);
  const insideWorkspace = relToWorkspace === '' || !isOutsideWorkspace(relToWorkspace);
  if (!insideWorkspace) {
    return {
      ok: false,
      result: errorResult(
        'symlink_escape',
        `Refusing to write through symlink whose target is outside the workspace: ${relPath}`,
        { path: relPath }
      ),
    };
  }
  return { ok: true, writePath: target, wasSymlink: true };
}

export function parseBatchEdits(
  value: unknown,
  options: { toolName?: string; minEdits?: number } = {}
):
  | { ok: true; edits: BatchEditInput[] }
  | { ok: false; code: string; message: string; details?: Record<string, unknown> }
  | undefined {
  if (value === undefined) return undefined;
  const toolName = options.toolName ?? 'Edit';
  const minEdits = options.minEdits ?? 1;
  if (!Array.isArray(value)) {
    return {
      ok: false,
      code: 'invalid_edits',
      message: `${toolName} edits must be an array of { old_string, new_string, replace_all? } objects`,
    };
  }
  if (value.length < minEdits) {
    return {
      ok: false,
      code: 'invalid_edits',
      message:
        minEdits === 1
          ? `${toolName} edits must include at least one replacement`
          : `${toolName} requires at least ${minEdits} replacements; use Edit for one exact replacement`,
      details: { editCount: value.length, minEdits },
    };
  }
  const edits: BatchEditInput[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!entry || typeof entry !== 'object') {
      return {
        ok: false,
        code: 'invalid_edits',
        message: `${toolName} edits[${index}] must be an object`,
        details: { editIndex: index },
      };
    }
    const edit = entry as Record<string, unknown>;
    if (typeof edit.old_string !== 'string' || typeof edit.new_string !== 'string') {
      return {
        ok: false,
        code: 'missing_strings',
        message: `${toolName} edits[${index}] requires old_string and new_string`,
        details: { editIndex: index },
      };
    }
    if (edit.old_string === edit.new_string) {
      return {
        ok: false,
        code: 'no_op',
        message: `${toolName} edits[${index}].old_string and new_string are identical`,
        details: { editIndex: index },
      };
    }
    edits.push({
      oldString: edit.old_string,
      newString: edit.new_string,
      replaceAll: edit.replace_all === true,
    });
  }
  return { ok: true, edits };
}

export async function runWithFileWriteLocks<T>(
  filePaths: string[],
  operation: () => Promise<T>
): Promise<T> {
  const uniquePaths = [...new Set(filePaths.map(filePath => path.resolve(filePath)))].sort();
  return uniquePaths.reduceRight(
    (next, filePath) => () => runWithFileWriteLock(filePath, next),
    operation
  )();
}
