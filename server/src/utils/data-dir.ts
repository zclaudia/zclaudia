import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Single source for the zclaudia data directory. Previously duplicated
 * verbatim in bash-runner.ts and command-executor.ts (and near-duplicated in
 * several stores); keep new consumers on this helper.
 */
export function resolveDataDir(): string {
  return process.env.ZCLAUDIA_DATA_DIR
    ? path.resolve(process.env.ZCLAUDIA_DATA_DIR)
    : path.join(os.homedir(), '.zclaudia');
}

/**
 * Pre-rename data root (`~/.claudia`). Only ever read, to seed files that do
 * not exist in {@link resolveDataDir} yet. `ZCLAUDIA_LEGACY_DATA_DIR` overrides
 * it — the test setup points it at a missing dir so tests never read the
 * developer's real legacy data.
 */
export function resolveLegacyDataDir(): string {
  return process.env.ZCLAUDIA_LEGACY_DATA_DIR
    ? path.resolve(process.env.ZCLAUDIA_LEGACY_DATA_DIR)
    : path.join(os.homedir(), '.claudia');
}

/**
 * One-time copy of a legacy file into the data dir: copies `legacyPath` to
 * `targetPath` only when the target does not exist yet and the legacy file
 * does. Never overwrites the target and never writes to the legacy location
 * (it stays in place for older builds). Returns whether a copy happened;
 * fs errors propagate to the caller.
 *
 * The target appears via a single hard link from a fully written temp sibling,
 * so an interrupted copy (ENOSPC, SIGKILL) never leaves a truncated target
 * behind — target existence doubles as the "already migrated" marker, and a
 * half-written file would permanently skip the migration. The link (rather
 * than a rename) keeps the no-clobber guarantee when two processes race the
 * same fresh data dir: the loser's link fails with EEXIST, reported as "no
 * copy happened".
 */
export function seedFromLegacyFile(legacyPath: string, targetPath: string): boolean {
  if (path.resolve(legacyPath) === path.resolve(targetPath)) return false;
  if (existsSync(targetPath) || !existsSync(legacyPath)) return false;
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.seed-${process.pid}-${Date.now()}`;
  try {
    copyFileSync(legacyPath, tempPath);
    try {
      linkSync(tempPath, targetPath);
    } catch (error) {
      // Another process created the target between the probe and the link —
      // it won, keep its file. Any other error still propagates.
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      // the temp file may not exist if the copy itself failed — best effort
    }
  }
  return true;
}

/**
 * Best-effort TTL sweep for *.log files in a data-dir subdirectory. Spilled
 * command/task logs are kept only long enough to be read back within a
 * session; without a sweep they accumulate forever. Call opportunistically on
 * each new write — no background timer. Missing dirs and vanished/locked
 * files are ignored.
 */
export function sweepStaleLogs(dir: string, maxAgeMs: number): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const name of entries) {
    if (!name.endsWith('.log')) continue;
    const filePath = path.join(dir, name);
    try {
      if (statSync(filePath).mtimeMs < cutoff) unlinkSync(filePath);
    } catch {
      // file vanished or is locked — ignore, this is best-effort
    }
  }
}
