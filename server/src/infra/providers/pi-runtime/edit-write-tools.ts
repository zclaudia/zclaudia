import type { AgentTool } from '@earendil-works/pi-agent-core';
import { mkdir, stat } from 'fs/promises';
import * as path from 'path';

import { findActualString, countOccurrences, applyEdit } from './edit-match.js';
import { buildFileDiff } from './diff.js';
import type { ReadFileStateStore } from './read-file-state.js';
import {
  mergeWriteLifecycleResults,
  runDiagnosticsProvider,
  runWriteLifecycle,
  scheduleDeferredDiagnostics,
  type DiagnosticsMode,
  type WriteDiagnosticsProvider,
  type WriteLifecycleHooks,
} from './write-lifecycle.js';
import { applyLineEndingStyle, buildContentDetailFields, lineEndingFor, readTextFileWithMetadata, writeTextFileAtomic } from './text-io.js';
import { MAX_EDIT_FILE_BYTES, validateMutationContent } from './write-guards.js';
import { recordFileBackup } from './file-history.js';
import { runWithFileWriteLock } from './file-write-lock.js';
import { parseApplyPatch } from './apply-patch.js';
import { replaceHashlineLine } from './hashline.js';

type TextBlock = { type: 'text'; text: string };
type ToolContent = TextBlock[];

export interface FileMutationToolOptions {
  readFileState?: ReadFileStateStore;
  writeLifecycle?: WriteLifecycleHooks;
  diagnosticsProvider?: WriteDiagnosticsProvider;
  diagnosticsMode?: DiagnosticsMode;
}

function textResult<TDetails extends Record<string, unknown> = Record<string, never>>(
  text: string,
  details?: TDetails,
): { content: ToolContent; details: TDetails | Record<string, never> } {
  return { content: [{ type: 'text', text }], details: details ?? {} };
}

function errorResult(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): { content: ToolContent; details: Record<string, unknown> } {
  return textResult(message, { ok: false, error: code, message, ...details });
}

function toolParams(first: unknown, second: unknown): Record<string, unknown> {
  const candidate = second ?? first;
  return candidate && typeof candidate === 'object'
    ? candidate as Record<string, unknown>
    : {};
}

function resolveInsideWorkspace(cwd: string, requestedPath: unknown): string {
  const rawPath = typeof requestedPath === 'string' && requestedPath.trim()
    ? requestedPath.trim()
    : '.';
  const resolved = path.resolve(cwd, rawPath);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path is outside workspace: ${rawPath}`);
  }
  return resolved;
}

function toWorkspaceRelative(cwd: string, filePath: string): string {
  return path.relative(cwd, path.resolve(filePath)).split(path.sep).join('/');
}

export function createWriteBridgeTool(cwd: string, options?: FileMutationToolOptions): AgentTool<any> {
  return {
    name: 'Write',
    label: 'Write',
    description: 'Write (create or overwrite) a file in the workspace. Creates parent directories as needed.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Workspace-relative path of the file to write' },
        content: { type: 'string', description: 'Full file contents' },
      },
      required: ['file_path', 'content'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const requested = args.file_path;
      if (typeof requested !== 'string' || !requested.trim()) {
        return errorResult('missing_path', 'Write requires file_path');
      }
      if (typeof args.content !== 'string') {
        return errorResult('missing_content', 'Write requires string content');
      }
      let filePath: string;
      try {
        filePath = resolveInsideWorkspace(cwd, requested);
      } catch (err) {
        return errorResult('path_outside_workspace', err instanceof Error ? err.message : String(err));
      }
      const contentGuard = validateMutationContent(filePath, args.content);
      if (contentGuard) {
        return errorResult(contentGuard.code, contentGuard.message, { path: toWorkspaceRelative(cwd, filePath) });
      }
      try {
        return await runWithFileWriteLock(filePath, async () => {
        let existed = false;
        let originalContent: string | null = null;
        try { existed = (await stat(filePath)).isFile(); } catch { /* new file */ }
        let originalMetadata: Awaited<ReturnType<typeof readTextFileWithMetadata>> | undefined;
        if (existed) {
          originalMetadata = await readTextFileWithMetadata(filePath);
          originalContent = originalMetadata.content;
          const readCheck = await options?.readFileState?.assertSafeToWrite(filePath, originalContent);
          if (readCheck && !readCheck.ok) {
            return errorResult(readCheck.code, readCheck.message, { path: toWorkspaceRelative(cwd, filePath) });
          }
        }
        await mkdir(path.dirname(filePath), { recursive: true });
        const relPath = toWorkspaceRelative(cwd, filePath);
        const backup = originalContent !== null ? await recordFileBackup(relPath, originalContent) : undefined;
        const updatedContentForDisk = originalContent !== null
          ? applyLineEndingStyle(args.content, lineEndingFor(originalContent))
          : args.content;
        await writeTextFileAtomic(filePath, updatedContentForDisk, originalMetadata);
        await options?.readFileState?.recordWrite(filePath, args.content);
        const diff = originalContent !== null
          ? buildFileDiff(relPath, originalContent, args.content)
          : buildFileDiff(relPath, '', args.content);
        const writeType = existed ? 'update' : 'create';
        const lifecycleInput = {
          operation: 'write',
          type: writeType,
          path: relPath,
          absolutePath: filePath,
          originalContent,
          updatedContent: args.content,
          diff: diff.diff,
          ...(diff.firstChangedLine !== undefined ? { firstChangedLine: diff.firstChangedLine } : {}),
        } as const;
        const lifecycle = mergeWriteLifecycleResults(
          await runWriteLifecycle(options?.writeLifecycle, lifecycleInput),
          options?.diagnosticsMode === 'deferred'
            ? scheduleDeferredDiagnostics(options?.diagnosticsProvider, lifecycleInput)
            : await runDiagnosticsProvider(options?.diagnosticsProvider, lifecycleInput),
        );
        return textResult(`Wrote ${relPath}`, {
          ok: true,
          type: writeType,
          path: relPath,
          diff: diff.diff,
          firstChangedLine: diff.firstChangedLine,
          structuredPatch: diff.structuredPatch,
          lineChanges: diff.lineChanges,
          ...buildContentDetailFields(originalContent, args.content),
          ...(backup ? { backup } : {}),
          ...(lifecycle ? { lifecycle } : {}),
        });
        });
      } catch (err) {
        return errorResult('write_failed', err instanceof Error ? err.message : String(err), { path: String(requested) });
      }
    },
  } as unknown as AgentTool<any>;
}

export function createEditBridgeTool(cwd: string, options?: FileMutationToolOptions): AgentTool<any> {
  return {
    name: 'Edit',
    label: 'Edit',
    description: 'Replace an exact string in an existing file, or apply a small multi-file patch.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Workspace-relative path of the file to edit' },
        old_string: { type: 'string', description: 'Exact text to replace' },
        new_string: { type: 'string', description: 'Replacement text' },
        replace_all: { type: 'boolean', default: false },
        patch: { type: 'string', description: 'Optional apply_patch-style multi-file patch' },
        hashline_line: { type: 'string', description: 'Optional line hash from Read(hashline:true)' },
      },
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (typeof args.patch === 'string' && args.patch.trim()) {
        try {
          const operations = parseApplyPatch(args.patch);
          const perFileResults = [];
          for (const operation of operations) {
            if (operation.type === 'add') {
              const writeTool = createWriteBridgeTool(cwd, options) as any;
              const result = await writeTool.execute(`${toolCallId}:add:${operation.path}`, {
                file_path: operation.path,
                content: operation.content,
              });
              if (result.details?.ok === false) return result;
              perFileResults.push({ ...result.details, path: operation.path });
              continue;
            }
            const editTool = createEditBridgeTool(cwd, options) as any;
            const result = await editTool.execute(`${toolCallId}:update:${operation.path}`, {
              file_path: operation.path,
              old_string: operation.oldText,
              new_string: operation.newText,
            });
            if (result.details?.ok === false) return result;
            perFileResults.push({ ...result.details, type: 'update', path: operation.path });
          }
          return textResult(`Applied patch to ${perFileResults.length} file(s)`, {
            ok: true,
            perFileResults,
            diff: perFileResults.map((result: any) => result.diff).filter(Boolean).join('\n'),
            firstChangedLine: perFileResults.find((result: any) => result.firstChangedLine)?.firstChangedLine,
          });
        } catch (err) {
          return errorResult('patch_failed', err instanceof Error ? err.message : String(err));
        }
      }
      const requested = args.file_path;
      if (typeof requested !== 'string' || !requested.trim()) {
        return errorResult('missing_path', 'Edit requires file_path');
      }
      const isHashlineEdit = typeof args.hashline_line === 'string' && args.hashline_line.trim();
      if (!isHashlineEdit && (typeof args.old_string !== 'string' || typeof args.new_string !== 'string')) {
        return errorResult('missing_strings', 'Edit requires old_string and new_string');
      }
      if (!isHashlineEdit && args.old_string === args.new_string) {
        return errorResult('no_op', 'old_string and new_string are identical');
      }
      if (typeof args.new_string !== 'string') {
        return errorResult('missing_strings', 'Edit requires new_string');
      }
      const replaceAll = args.replace_all === true;
      let filePath: string;
      try {
        filePath = resolveInsideWorkspace(cwd, requested);
      } catch (err) {
        return errorResult('path_outside_workspace', err instanceof Error ? err.message : String(err));
      }
      const replacementGuard = validateMutationContent(filePath, args.new_string);
      if (replacementGuard) {
        return errorResult(replacementGuard.code, replacementGuard.message, { path: toWorkspaceRelative(cwd, filePath) });
      }
      try {
        return await runWithFileWriteLock(filePath, async () => {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) {
          return errorResult('not_a_file', `Path is not a file: ${toWorkspaceRelative(cwd, filePath)}`);
        }
        if (fileStat.size > MAX_EDIT_FILE_BYTES) {
          return errorResult('file_too_large', `File is too large to edit safely: ${toWorkspaceRelative(cwd, filePath)}`, {
            path: toWorkspaceRelative(cwd, filePath),
            size: fileStat.size,
            maxSize: MAX_EDIT_FILE_BYTES,
          });
        }
        if (path.extname(filePath).toLowerCase() === '.ipynb') {
          return errorResult('unsupported_notebook_edit', 'Jupyter notebooks require a notebook-aware edit tool.', {
            path: toWorkspaceRelative(cwd, filePath),
          });
        }
        const originalMetadata = await readTextFileWithMetadata(filePath);
        const original = originalMetadata.content;
        const readCheck = await options?.readFileState?.assertSafeToWrite(filePath, original);
        if (readCheck && !readCheck.ok) {
          return errorResult(readCheck.code, readCheck.message, { path: toWorkspaceRelative(cwd, filePath) });
        }
        const actual = isHashlineEdit ? null : findActualString(original, args.old_string);
        if (isHashlineEdit) {
          const updated = replaceHashlineLine(original, String(args.hashline_line), args.new_string);
          if (updated === undefined) {
            return errorResult('hashline_mismatch', 'hashline_line was not found in the current file', {
              path: toWorkspaceRelative(cwd, filePath),
            });
          }
          const relPath = toWorkspaceRelative(cwd, filePath);
          const diff = buildFileDiff(relPath, original, updated);
          if (args.preview_only === true) {
            return textResult(`Previewed edit ${relPath}`, {
              ok: true,
              preview: true,
              path: relPath,
              replaced: 1,
              diff: diff.diff,
              firstChangedLine: diff.firstChangedLine,
              structuredPatch: diff.structuredPatch,
              lineChanges: diff.lineChanges,
              ...buildContentDetailFields(original, updated),
            });
          }
          const backup = await recordFileBackup(relPath, original);
          await writeTextFileAtomic(filePath, applyLineEndingStyle(updated, lineEndingFor(original)), originalMetadata);
          await options?.readFileState?.recordWrite(filePath, updated);
          return textResult(`Edited ${relPath}`, {
            ok: true,
            path: relPath,
            replaced: 1,
            diff: diff.diff,
            firstChangedLine: diff.firstChangedLine,
            structuredPatch: diff.structuredPatch,
            lineChanges: diff.lineChanges,
            ...buildContentDetailFields(original, updated),
            backup,
          });
        }
        if (actual === null) {
          return errorResult('not_found', 'old_string not found in file', { path: toWorkspaceRelative(cwd, filePath) });
        }
        const occurrences = countOccurrences(original, actual);
        if (!replaceAll && occurrences > 1) {
          return errorResult('not_unique', `old_string appears ${occurrences} times; pass replace_all:true or add more context`, {
            path: toWorkspaceRelative(cwd, filePath),
            occurrences,
          });
        }
        const updated = applyEdit(original, actual, args.new_string, replaceAll);
        const relPath = toWorkspaceRelative(cwd, filePath);
        const diff = buildFileDiff(relPath, original, updated);
        if (args.preview_only === true) {
          return textResult(`Previewed edit ${relPath}`, {
            ok: true,
            preview: true,
            path: relPath,
            replaced: replaceAll ? occurrences : 1,
            diff: diff.diff,
            firstChangedLine: diff.firstChangedLine,
            structuredPatch: diff.structuredPatch,
            lineChanges: diff.lineChanges,
            ...buildContentDetailFields(original, updated),
          });
        }
        const backup = await recordFileBackup(relPath, original);
        await writeTextFileAtomic(filePath, applyLineEndingStyle(updated, lineEndingFor(original)), originalMetadata);
        await options?.readFileState?.recordWrite(filePath, updated);
        const lifecycleInput = {
          operation: 'edit',
          type: 'update',
          path: relPath,
          absolutePath: filePath,
          originalContent: original,
          updatedContent: updated,
          diff: diff.diff,
          ...(diff.firstChangedLine !== undefined ? { firstChangedLine: diff.firstChangedLine } : {}),
        } as const;
        const lifecycle = mergeWriteLifecycleResults(
          await runWriteLifecycle(options?.writeLifecycle, lifecycleInput),
          options?.diagnosticsMode === 'deferred'
            ? scheduleDeferredDiagnostics(options?.diagnosticsProvider, lifecycleInput)
            : await runDiagnosticsProvider(options?.diagnosticsProvider, lifecycleInput),
        );
        return textResult(`Edited ${relPath}`, {
          ok: true,
          path: relPath,
          replaced: replaceAll ? occurrences : 1,
          diff: diff.diff,
          firstChangedLine: diff.firstChangedLine,
          structuredPatch: diff.structuredPatch,
          lineChanges: diff.lineChanges,
          ...buildContentDetailFields(original, updated),
          backup,
          ...(lifecycle ? { lifecycle } : {}),
        });
        });
      } catch (err) {
        return errorResult('edit_failed', err instanceof Error ? err.message : String(err), { path: String(requested) });
      }
    },
  } as unknown as AgentTool<any>;
}
