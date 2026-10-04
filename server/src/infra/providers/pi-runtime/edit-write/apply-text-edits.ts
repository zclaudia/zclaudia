/**
 * Apply language-server text edits to several files, all or nothing.
 *
 * Edits carry LSP ranges over the exact text the server was given, which is
 * the file's raw UTF-8 (CRLF and a BOM included), so they are applied to that
 * raw text and written back as is — no line-ending or BOM normalization that
 * would shift positions. The steps:
 *   1. lock every file (sorted, deadlock-free);
 *   2. check each file still hashes to what the edits were computed against;
 *   3. compute every new content in memory and run the content guards;
 *   4. write them one by one, restoring the already-written ones on failure.
 * Nothing is written unless all files pass steps 2–3.
 */
import { createHash } from 'crypto';
import { readFile, stat } from 'fs/promises';
import type { LspTextEdit } from '../../language-server-port.js';
import { buildFileDiff } from '../diff.js';
import { recordFileBackup } from '../file-history.js';
import { decodeTextBuffer, writeTextFileAtomic } from '../text-io.js';
import { validateMutationContent } from '../write-guards.js';
import {
  mergeWriteLifecycleResults,
  runWriteLifecycle,
  scheduleDeferredDiagnostics,
  type WriteLifecycleResult,
} from '../write-lifecycle.js';
import { buildMutationDetailsBase } from './mutation-details.js';
import { PatchDiagnosticsTargets, runPatchDiagnostics } from './patch-diagnostics.js';
import {
  runWithFileWriteLocks,
  type FileMutationToolOptions,
  type MutationDetails,
} from './shared.js';

export interface FileTextEdits {
  absolutePath: string;
  /** Workspace-relative path, as reported to the model. */
  path: string;
  /** sha1 of the UTF-8 text the edits were computed against. */
  contentHash: string;
  edits: LspTextEdit[];
}

export type ApplyTextEditsOutcome =
  | { ok: true; perFileResults: MutationDetails[]; diff: string }
  | { ok: false; error: string; message: string; path?: string };

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

function stripBom(text: string): string {
  return text.startsWith('﻿') ? text.slice(1) : text;
}

/** Offsets where each line starts; LSP lines end at \n, \r\n or \r. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '\r') {
      if (text[index + 1] === '\n') index++;
      starts.push(index + 1);
    } else if (char === '\n') {
      starts.push(index + 1);
    }
  }
  return starts;
}

function offsetOf(text: string, starts: number[], line: number, character: number): number {
  if (line < 0 || character < 0) throw new Error(`invalid position ${line}:${character}`);
  if (line >= starts.length) return text.length;
  let lineEnd = text.length;
  if (line + 1 < starts.length) {
    // The next line's start, minus this line's terminator (\n, \r\n or \r).
    lineEnd = starts[line + 1];
    if (text[lineEnd - 1] === '\n') lineEnd--;
    if (text[lineEnd - 1] === '\r') lineEnd--;
  }
  // A character past the end of the line means the end of the line (LSP).
  return Math.min(starts[line] + character, lineEnd);
}

/**
 * Apply non-overlapping edits (positions in UTF-16 code units, which is what
 * JS string indices are). Throws on overlapping edits.
 */
export function applyTextEdits(text: string, edits: LspTextEdit[]): string {
  const starts = lineStarts(text);
  const resolved = edits
    .map((edit, order) => ({
      start: offsetOf(text, starts, edit.startLine, edit.startCharacter),
      end: offsetOf(text, starts, edit.endLine, edit.endCharacter),
      newText: edit.newText,
      order,
    }))
    .sort((a, b) => a.start - b.start || a.order - b.order);
  for (let index = 0; index < resolved.length; index++) {
    const edit = resolved[index];
    if (edit.end < edit.start) throw new Error('an edit ends before it starts');
    const next = resolved[index + 1];
    if (next && next.start < edit.end) throw new Error('the edits overlap');
  }
  let result = text;
  for (let index = resolved.length - 1; index >= 0; index--) {
    const edit = resolved[index];
    result = result.slice(0, edit.start) + edit.newText + result.slice(edit.end);
  }
  return result;
}

interface PreparedFile {
  file: FileTextEdits;
  original: string;
  updated: string;
  mode: number;
}

export async function applyFileEditsAtomically(
  files: FileTextEdits[],
  options: FileMutationToolOptions | undefined,
  { previewOnly = false }: { previewOnly?: boolean } = {}
): Promise<ApplyTextEditsOutcome> {
  const outcome = await runWithFileWriteLocks(
    files.map(file => file.absolutePath),
    async (): Promise<ApplyTextEditsOutcome | PreparedFile[]> => {
      const prepared: PreparedFile[] = [];
      for (const file of files) {
        let buffer: Buffer;
        let mode: number;
        try {
          [buffer, mode] = await Promise.all([
            readFile(file.absolutePath),
            stat(file.absolutePath).then(info => info.mode & 0o7777),
          ]);
        } catch (err) {
          return {
            ok: false,
            error: 'apply_failed',
            message: `Cannot read ${file.path}: ${err instanceof Error ? err.message : String(err)}`,
            path: file.path,
          };
        }
        if (decodeTextBuffer(buffer).encoding !== 'utf8') {
          return {
            ok: false,
            error: 'unsupported_encoding',
            message: `${file.path} is not UTF-8; rename it with Edit instead`,
            path: file.path,
          };
        }
        const original = buffer.toString('utf8');
        if (sha1(original) !== file.contentHash) {
          return {
            ok: false,
            error: 'stale_content',
            message: `${file.path} changed after the rename was computed; nothing was written. Retry the rename.`,
            path: file.path,
          };
        }
        let updated: string;
        try {
          updated = applyTextEdits(original, file.edits);
        } catch (err) {
          return {
            ok: false,
            error: 'apply_failed',
            message: `Cannot apply the edits to ${file.path}: ${err instanceof Error ? err.message : String(err)}`,
            path: file.path,
          };
        }
        const guard = validateMutationContent(file.absolutePath, stripBom(updated));
        if (guard) {
          return { ok: false, error: guard.code, message: guard.message, path: file.path };
        }
        prepared.push({ file, original, updated, mode });
      }
      if (previewOnly) return prepared;

      const written: PreparedFile[] = [];
      for (const entry of prepared) {
        try {
          // The raw text keeps its own BOM character and line endings.
          await writeTextFileAtomic(entry.file.absolutePath, entry.updated, {
            encoding: 'utf8',
            hasBom: false,
            mode: entry.mode,
          });
          written.push(entry);
        } catch (err) {
          const restoreFailures: string[] = [];
          for (const done of written.reverse()) {
            await writeTextFileAtomic(done.file.absolutePath, done.original, {
              encoding: 'utf8',
              hasBom: false,
              mode: done.mode,
            }).catch(() => restoreFailures.push(done.file.path));
          }
          return {
            ok: false,
            error: 'apply_failed',
            message:
              `Writing ${entry.file.path} failed (${err instanceof Error ? err.message : String(err)}); ` +
              (restoreFailures.length === 0
                ? 'files written before it were restored, so nothing changed.'
                : `could not restore ${restoreFailures.join(', ')}.`),
            path: entry.file.path,
          };
        }
      }
      return prepared;
    }
  );
  if (!Array.isArray(outcome)) return outcome;

  const perFileResults: MutationDetails[] = [];
  const targets = new PatchDiagnosticsTargets();
  for (const entry of outcome) {
    const { file, original, updated } = entry;
    const diff = buildFileDiff(file.path, stripBom(original), stripBom(updated));
    let backup: Awaited<ReturnType<typeof recordFileBackup>> | undefined;
    let lifecycle: WriteLifecycleResult | undefined;
    if (!previewOnly) {
      backup = await recordFileBackup(file.path, original, file.absolutePath);
      await options?.readFileState?.recordWrite(file.absolutePath, stripBom(updated));
      options?.noopGuard?.clear(file.absolutePath);
      const lifecycleInput = {
        operation: 'edit',
        type: 'update',
        path: file.path,
        absolutePath: file.absolutePath,
        originalContent: original,
        updatedContent: updated,
        diff: diff.diff,
        ...(diff.firstChangedLine !== undefined ? { firstChangedLine: diff.firstChangedLine } : {}),
      } as const;
      lifecycle = mergeWriteLifecycleResults(
        await runWriteLifecycle(options?.writeLifecycle, lifecycleInput),
        options?.diagnosticsMode === 'deferred'
          ? scheduleDeferredDiagnostics(options?.diagnosticsProvider, lifecycleInput)
          : undefined
      );
      targets.add({ path: file.path, absolutePath: file.absolutePath, originalContent: original });
    }
    perFileResults.push({
      ...buildMutationDetailsBase({
        path: file.path,
        diff,
        extra: { type: 'update', ...(backup ? { backup } : {}) },
      }),
      ok: true,
      type: 'update',
      path: file.path,
      edits: file.edits.length,
      ...(previewOnly ? { preview: true } : {}),
      ...(backup ? { backup } : {}),
      ...(lifecycle ? { lifecycle } : {}),
    });
  }
  // Every file is on disk before any is checked (see patch-diagnostics.ts).
  if (!previewOnly && options?.diagnosticsProvider && options.diagnosticsMode !== 'deferred') {
    await runPatchDiagnostics(options.diagnosticsProvider, targets.list(), perFileResults);
  }
  const diff = perFileResults
    .map(result => result.diff)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n');
  return { ok: true, perFileResults, diff };
}
