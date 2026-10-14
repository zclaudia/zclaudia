/**
 * Pure matching/application core for the single-file Edit paths: read-guard
 * decisions (including stale-read rebasing), exact/quote/whitespace matching,
 * same-file batch application, and hashline replacement. Everything here
 * receives in-memory content and returns plain results — no fs, no locks, no
 * loop-guard state. The tool shell in edit-tool.ts owns I/O and the noop-edit
 * guard, and turns these structured outcomes into tool results.
 */

import {
  applyEdit,
  countOccurrences,
  findActualString,
  findWhitespaceMatch,
} from '../edit-match.js';
import { buildFileStateErrorDescriptor } from '../file-state.js';
import { hashlineTag, replaceHashlineLine } from '../hashline.js';
import type { ReadFileStateEntry } from '../read-file-state.js';
import { errorResult, readGuardFailureDetails, type BatchEditInput } from './shared.js';

/** The tool-result shape shared by all mutation outcomes. */
export type MutationOutcome = ReturnType<typeof errorResult>;

export type ReadGuardCheck = { ok: true } | { ok: false; code: string; message: string };

export type ReadGuardDecision =
  | { proceed: true; rebased: boolean }
  | { proceed: false; result: MutationOutcome };

/**
 * Decide how to proceed after the read-state guard ran: a stale exact (not
 * hashline) read triggers rebase-then-verify instead of an immediate failure;
 * every other failed check fails the edit up front.
 */
export function evaluateReadGuard(input: {
  readCheck: ReadGuardCheck | undefined;
  isHashlineEdit: boolean;
  relPath: string;
  currentContent: string;
  readEntry?: ReadFileStateEntry;
}): ReadGuardDecision {
  const { readCheck, isHashlineEdit, relPath, currentContent, readEntry } = input;
  if (!readCheck || readCheck.ok) return { proceed: true, rebased: false };
  if (!isHashlineEdit && readCheck.code === 'file_modified_since_read') {
    return { proceed: true, rebased: true };
  }
  return {
    proceed: false,
    result: errorResult(
      readCheck.code,
      readCheck.message,
      readGuardFailureDetails({
        code: readCheck.code,
        relPath,
        currentContent,
        readEntry,
      })
    ),
  };
}

export interface StaleRebaseContext {
  rebased: boolean;
  relPath: string;
  currentContent: string;
  readEntry?: ReadFileStateEntry;
}

/**
 * Failure factory for the exact/batch match paths. Without a rebase the
 * original failure passes through; after a rebase any subsequent mismatch is
 * reported as a stale read, because the content the anchors were validated
 * against is gone.
 */
export function createStaleRebaseFailure(context: StaleRebaseContext) {
  return (
    code: string,
    message: string,
    details: Record<string, unknown> = {}
  ): MutationOutcome => {
    if (!context.rebased) return errorResult(code, message, details);
    return errorResult(
      'file_modified_since_read',
      'File has changed since it was read and the requested edit could not be safely rebased. Read it again before editing.',
      readGuardFailureDetails({
        code: 'file_modified_since_read',
        relPath: context.relPath,
        currentContent: context.currentContent,
        readEntry: context.readEntry,
        extra: {
          rebaseFailed: true,
          rebaseError: code,
          ...details,
        },
      })
    );
  };
}

export interface BatchAppliedEdit {
  index: number;
  replaced: number;
  replaceAll: boolean;
}

export type BatchEditApplication =
  | {
      ok: true;
      updated: string;
      totalReplaced: number;
      appliedEdits: BatchAppliedEdit[];
    }
  | { ok: false; kind: 'not_found'; index: number; oldString: string }
  | {
      ok: false;
      kind: 'not_unique';
      index: number;
      occurrences: number;
      /** True when the ambiguity comes from whitespace-normalized matching. */
      matchedAfterNormalization: boolean;
    };

/**
 * Apply a same-file batch sequentially against in-memory content. Each edit
 * sees the result of the previous one; the first failure stops the batch with
 * nothing written.
 */
export function applyBatchEdits(original: string, edits: BatchEditInput[]): BatchEditApplication {
  let updated = original;
  let totalReplaced = 0;
  const appliedEdits: BatchAppliedEdit[] = [];
  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index];
    const actual = findActualString(updated, edit.oldString);
    if (actual === null) {
      const ws = findWhitespaceMatch(updated, edit.oldString, edit.newString);
      if (ws.ok) {
        updated =
          updated.slice(0, ws.match.start) +
          ws.match.adjustedNewString +
          updated.slice(ws.match.end);
        totalReplaced += 1;
        appliedEdits.push({ index, replaced: 1, replaceAll: edit.replaceAll });
        continue;
      }
      if (ws.reason === 'ambiguous') {
        return {
          ok: false,
          kind: 'not_unique',
          index,
          occurrences: ws.count ?? 0,
          matchedAfterNormalization: true,
        };
      }
      return { ok: false, kind: 'not_found', index, oldString: edit.oldString };
    }
    const occurrences = countOccurrences(updated, actual);
    if (!edit.replaceAll && occurrences > 1) {
      return {
        ok: false,
        kind: 'not_unique',
        index,
        occurrences,
        matchedAfterNormalization: false,
      };
    }
    const replaced = edit.replaceAll ? occurrences : 1;
    updated = applyEdit(updated, actual, edit.newString, edit.replaceAll);
    totalReplaced += replaced;
    appliedEdits.push({ index, replaced, replaceAll: edit.replaceAll });
  }
  return { ok: true, updated, totalReplaced, appliedEdits };
}

export type ExactEditApplication =
  | {
      ok: true;
      updated: string;
      replaced: number;
      matchStrategy: 'exact' | 'quote' | 'whitespace';
    }
  | { ok: false; kind: 'not_found'; oldString: string }
  | {
      ok: false;
      kind: 'not_unique';
      occurrences: number;
      /** True when the ambiguity comes from whitespace-normalized matching. */
      matchedAfterNormalization: boolean;
    };

/**
 * Match and apply one replacement against in-memory content: exact match,
 * quote-normalized match, then the whitespace-tolerant fallback.
 */
export function applyExactEdit(
  original: string,
  oldString: string,
  newString: string,
  replaceAll: boolean
): ExactEditApplication {
  const actual = findActualString(original, oldString);
  if (actual === null) {
    const ws = findWhitespaceMatch(original, oldString, newString);
    if (ws.ok) {
      return {
        ok: true,
        updated:
          original.slice(0, ws.match.start) +
          ws.match.adjustedNewString +
          original.slice(ws.match.end),
        replaced: 1,
        matchStrategy: 'whitespace',
      };
    }
    if (ws.reason === 'ambiguous') {
      return {
        ok: false,
        kind: 'not_unique',
        occurrences: ws.count ?? 0,
        matchedAfterNormalization: true,
      };
    }
    return { ok: false, kind: 'not_found', oldString };
  }
  const occurrences = countOccurrences(original, actual);
  if (!replaceAll && occurrences > 1) {
    return {
      ok: false,
      kind: 'not_unique',
      occurrences,
      matchedAfterNormalization: false,
    };
  }
  return {
    ok: true,
    updated: applyEdit(original, actual, newString, replaceAll),
    replaced: replaceAll ? occurrences : 1,
    matchStrategy: actual === oldString ? 'exact' : 'quote',
  };
}

/**
 * Apply a hashline-anchored replacement against in-memory content, using the
 * read snapshot to disambiguate duplicate lines. Undefined when the anchor no
 * longer matches.
 */
export function applyHashlineEdit(
  original: string,
  hashlineLine: string,
  newString: string,
  snapshot: string | undefined
): string | undefined {
  return replaceHashlineLine(original, hashlineLine, newString, snapshot);
}

/**
 * Hashline edits tolerate out-of-band drift: the content-hash anchor — not the
 * file-level tag — decides whether the edit is safe. A supplied tag that no
 * longer matches only marks the result as rebased.
 */
export function detectHashlineTagDrift(original: string, requestedTag: unknown): boolean {
  if (typeof requestedTag !== 'string' || !requestedTag.trim()) return false;
  return hashlineTag(original) !== requestedTag.trim();
}

/** The structured hashline_mismatch failure, including file-state context. */
export function hashlineMismatchError(input: {
  relPath: string;
  tagDrift: boolean;
  currentContent: string;
  readEntry?: ReadFileStateEntry;
}): MutationOutcome {
  return errorResult(
    'hashline_mismatch',
    'hashline_line was not found in the current file' +
      (input.tagDrift ? ' (the file has changed since it was read)' : ''),
    {
      path: input.relPath,
      retryable: true,
      suggestedAction: 'refresh_hashline',
      suggestion: 'Read the file again with hashline:true before editing.',
      state: buildFileStateErrorDescriptor({
        relPath: input.relPath,
        currentContent: input.currentContent,
        readContent: input.readEntry?.content,
        hasFullContent: input.readEntry?.hasFullContent,
        partialView: input.readEntry?.isPartialView,
      }),
    }
  );
}
