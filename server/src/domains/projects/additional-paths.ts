import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveDataDir } from '../../utils/data-dir.js';
import { SENSITIVE_DENY_READ } from '../../utils/sensitive-paths.js';

/** Hard cap on additional directories per project. */
export const MAX_ADDITIONAL_PATHS = 8;

function isWithin(child: string, parent: string): boolean {
  return (
    child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)
  );
}

function realOrResolved(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

function forbiddenReason(real: string): string | null {
  if (path.parse(real).root === real) return 'the filesystem root';
  if (real === realOrResolved(os.homedir())) return 'your home directory';
  if (isWithin(real, realOrResolved(resolveDataDir()))) return 'the ZClaudia data directory';
  for (const sensitive of SENSITIVE_DENY_READ) {
    if (isWithin(real, realOrResolved(sensitive))) return 'a credentials location';
  }
  return null;
}

/**
 * Validate and canonicalise a project's additional directories.
 *
 * `dropMissing` skips entries that no longer exist instead of throwing; used when
 * re-validating already-saved paths after an unrelated change.
 *
 * Throws (message always contains "must"/"only" so the route maps it to a 400)
 * for entries that can never work: relative, missing, not a directory, or
 * forbidden. Entries that are merely redundant — duplicates, the primary root
 * itself, or anything inside the primary root / another additional directory —
 * are dropped silently, since they are already reachable.
 */
export function normalizeAdditionalPaths(
  rootPath: string | undefined,
  paths: readonly string[],
  options: { dropMissing?: boolean } = {}
): string[] {
  if (paths.length === 0) return [];
  if (!rootPath) {
    throw new Error('Additional directories can only be set when the project has a root path');
  }

  const realRoot = realOrResolved(rootPath);
  const resolved: string[] = [];
  for (const raw of paths) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (!path.isAbsolute(trimmed)) {
      throw new Error(`Additional directory must be an absolute path: ${trimmed}`);
    }
    let real: string;
    try {
      real = fs.realpathSync.native(trimmed);
    } catch {
      if (options.dropMissing) continue;
      throw new Error(`Additional directory must exist: ${trimmed}`);
    }
    if (!fs.statSync(real).isDirectory()) {
      throw new Error(`Additional directory must be a directory: ${trimmed}`);
    }
    const forbidden = forbiddenReason(real);
    if (forbidden) {
      throw new Error(`Additional directory must not be ${forbidden}: ${trimmed}`);
    }
    resolved.push(real);
  }

  // Shortest first so a parent absorbs children listed before or after it.
  const kept: string[] = [];
  for (const real of [...new Set(resolved)].sort((a, b) => a.length - b.length)) {
    if (isWithin(real, realRoot)) continue;
    if (kept.some(existing => isWithin(real, existing))) continue;
    kept.push(real);
  }

  // Restore the caller's order (first occurrence wins) for stable display.
  const order = new Map<string, number>();
  resolved.forEach((p, i) => {
    if (!order.has(p)) order.set(p, i);
  });
  kept.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

  if (kept.length > MAX_ADDITIONAL_PATHS) {
    throw new Error(`A project must have at most ${MAX_ADDITIONAL_PATHS} additional directories`);
  }
  return kept;
}

interface AdditionalPathsDb {
  prepare(sql: string): { get(...params: unknown[]): unknown };
}

/**
 * Load a project's additional directories for a run. Entries that no longer
 * exist (or are not absolute directories) are skipped with a warning so a stale
 * directory never fails the whole run.
 */
export function loadProjectAdditionalRoots(db: AdditionalPathsDb, projectId: string): string[] {
  const row = db.prepare('SELECT additional_paths FROM projects WHERE id = ?').get(projectId) as
    | { additional_paths?: string | null }
    | undefined;
  if (!row?.additional_paths) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.additional_paths);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const roots: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'string' || !path.isAbsolute(entry)) {
      console.warn(`[additional-dirs] Skipping invalid additional directory: ${String(entry)}`);
      continue;
    }
    try {
      if (!fs.statSync(entry).isDirectory()) throw new Error('not a directory');
    } catch {
      console.warn(`[additional-dirs] Skipping unavailable additional directory: ${entry}`);
      continue;
    }
    roots.push(entry);
  }
  return roots;
}
