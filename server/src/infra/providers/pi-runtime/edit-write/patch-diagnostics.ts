/**
 * Write diagnostics for multi-file patches.
 *
 * Checking each file right after its own write would report errors a later
 * operation of the same patch fixes (a file importing something the next file
 * adds). So a patch writes everything first and checks the changed files
 * afterwards, together, against their pre-patch content.
 */
import { readTextFileWithMetadata } from '../text-io.js';
import {
  mergeWriteLifecycleResults,
  runDiagnosticsProvider,
  type WriteDiagnosticsProvider,
  type WriteLifecycleResult,
} from '../write-lifecycle.js';
import type { FileDiagnosticsReport } from './mutation-details.js';
import type { MutationDetails } from './shared.js';

export interface PatchDiagnosticsTarget {
  /** Workspace-relative path, as reported in perFileResults. */
  path: string;
  absolutePath: string;
  /** Content before the patch; null for a file the patch created. */
  originalContent: string | null;
}

/** Records each file's pre-patch content the first time the patch touches it. */
export class PatchDiagnosticsTargets {
  private readonly targets = new Map<string, PatchDiagnosticsTarget>();

  has(absolutePath: string): boolean {
    return this.targets.has(absolutePath);
  }

  add(target: PatchDiagnosticsTarget): void {
    if (!this.targets.has(target.absolutePath)) this.targets.set(target.absolutePath, target);
  }

  /** Reads the current content as the baseline (before an update operation). */
  async addFromDisk(path: string, absolutePath: string): Promise<void> {
    if (this.targets.has(absolutePath)) return;
    try {
      const { content } = await readTextFileWithMetadata(absolutePath);
      this.add({ path, absolutePath, originalContent: content });
    } catch {
      // Unreadable: the update itself will fail and report why.
    }
  }

  list(): PatchDiagnosticsTarget[] {
    return [...this.targets.values()];
  }
}

/**
 * Check every successfully written file once all operations have run, and
 * fold each result into that file's perFileResults entry.
 */
export async function runPatchDiagnostics(
  provider: WriteDiagnosticsProvider,
  targets: PatchDiagnosticsTarget[],
  perFileResults: MutationDetails[]
): Promise<void> {
  const written = targets.filter(target =>
    perFileResults.some(
      result => result.ok !== false && result.path === target.path && result.type !== 'delete'
    )
  );
  // One at a time: each check diagnoses the other open files before and
  // after its own file, which concurrent checks would interleave.
  const allPaths = written.map(target => target.absolutePath);
  const results: Array<{ target: PatchDiagnosticsTarget; lifecycle?: WriteLifecycleResult }> = [];
  for (const target of written) {
    let updatedContent: string;
    try {
      updatedContent = (await readTextFileWithMetadata(target.absolutePath)).content;
    } catch {
      continue;
    }
    results.push({
      target,
      lifecycle: await runDiagnosticsProvider(provider, {
        operation: target.originalContent === null ? 'write' : 'edit',
        type: target.originalContent === null ? 'create' : 'update',
        path: target.path,
        absolutePath: target.absolutePath,
        originalContent: target.originalContent,
        updatedContent,
        diff: '',
        otherChangedPaths: allPaths.filter(other => other !== target.absolutePath),
      }),
    });
  }
  for (const result of results) {
    if (!result.lifecycle) continue;
    // The last entry for the path carries the final state of the file.
    const entry = [...perFileResults]
      .reverse()
      .find(candidate => candidate.ok !== false && candidate.path === result.target.path);
    if (!entry) continue;
    entry.lifecycle = mergeWriteLifecycleResults(
      entry.lifecycle as WriteLifecycleResult | undefined,
      result.lifecycle
    );
  }
}

function lifecycleOf(entry: MutationDetails): WriteLifecycleResult | undefined {
  const lifecycle = entry.lifecycle;
  return lifecycle && typeof lifecycle === 'object'
    ? (lifecycle as WriteLifecycleResult)
    : undefined;
}

/** The language-server report of each changed file, for the result text. */
export function collectDiagnosticsReports(
  perFileResults: MutationDetails[]
): FileDiagnosticsReport[] {
  const reports: FileDiagnosticsReport[] = [];
  for (const entry of perFileResults) {
    const report = lifecycleOf(entry)?.diagnosticsReport;
    if (report && typeof entry.path === 'string') reports.push({ path: entry.path, report });
  }
  return reports;
}

/**
 * One lifecycle for the whole patch, so the UI shows every file's diagnostics
 * and warnings. The per-file `diagnosticsReport` is model-only and stays put.
 */
export function mergePerFileLifecycles(
  perFileResults: MutationDetails[]
): WriteLifecycleResult | undefined {
  let merged: WriteLifecycleResult | undefined;
  for (const entry of perFileResults) {
    const lifecycle = lifecycleOf(entry);
    if (!lifecycle) continue;
    const { diagnosticsReport: _report, ...rest } = lifecycle;
    merged = mergeWriteLifecycleResults(merged, rest);
  }
  if (!merged) return undefined;
  return Object.keys(merged).length > 0 ? merged : undefined;
}
