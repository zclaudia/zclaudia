/**
 * The shared tail of the single-file Edit mutation paths (batch, hashline,
 * exact): back up the original, write the updated content atomically, record
 * the write in the read-state store, then run the write lifecycle and the
 * diagnostics provider. The three paths share this tail so none of them can
 * drift from the others again — e.g. skipping the lifecycle check.
 */

import type { FileDiffResult } from '../diff.js';
import { recordFileBackup } from '../file-history.js';
import type { TextFileMetadata } from '../text-io.js';
import { applyLineEndingStyle, lineEndingFor, writeTextFileAtomic } from '../text-io.js';
import {
  mergeWriteLifecycleResults,
  runDiagnosticsProvider,
  runWriteLifecycle,
  scheduleDeferredDiagnostics,
  type WriteLifecycleResult,
} from '../write-lifecycle.js';
import type { FileMutationToolOptions } from './shared.js';

export interface PersistMutationInput {
  options: FileMutationToolOptions | undefined;
  /** Workspace-relative path, as reported in lifecycle input and backups. */
  relPath: string;
  /** Absolute (workspace-joined) path keyed by the read-state store. */
  filePath: string;
  /** Symlink-resolved path the bytes are actually written through. */
  writePath: string;
  original: string;
  updated: string;
  originalMetadata: TextFileMetadata;
  diff: FileDiffResult;
  /**
   * Whether to clear the noop-edit guard after the write. The batch and exact
   * paths clear here (unconditionally / when the content changed); the
   * hashline path already recorded or cleared its guard before the write and
   * passes false.
   */
  clearNoopGuard: boolean;
}

export interface PersistMutationOutput {
  backup: Awaited<ReturnType<typeof recordFileBackup>>;
  lifecycle: WriteLifecycleResult | undefined;
}

export async function persistMutation(input: PersistMutationInput): Promise<PersistMutationOutput> {
  const { options, relPath, filePath, writePath, original, updated, originalMetadata, diff } =
    input;
  const backup = await recordFileBackup(relPath, original, writePath);
  await writeTextFileAtomic(
    writePath,
    applyLineEndingStyle(updated, lineEndingFor(original)),
    originalMetadata
  );
  await options?.readFileState?.recordWrite(filePath, updated);
  if (input.clearNoopGuard) options?.noopGuard?.clear(filePath);
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
      : await runDiagnosticsProvider(options?.diagnosticsProvider, lifecycleInput)
  );
  return { backup, lifecycle };
}
