import { readdirSync, statSync, unlinkSync } from 'fs';
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
