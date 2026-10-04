import {
  constants,
  copyFileSync,
  existsSync,
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
 */
export function seedFromLegacyFile(legacyPath: string, targetPath: string): boolean {
  if (path.resolve(legacyPath) === path.resolve(targetPath)) return false;
  if (existsSync(targetPath) || !existsSync(legacyPath)) return false;
  mkdirSync(path.dirname(targetPath), { recursive: true });
  // EXCL: never clobber a file another process created in the meantime.
  copyFileSync(legacyPath, targetPath, constants.COPYFILE_EXCL);
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
