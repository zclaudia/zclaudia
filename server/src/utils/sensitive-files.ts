import { DEFAULT_SENSITIVE_PATTERNS } from '@zclaudia/shared/interaction/permissions';
import * as path from 'path';
import { minimatch } from 'minimatch';

/**
 * Whether a path names a file that holds secrets (`.env`, keys, credentials),
 * by basename against the shared default patterns. The permission evaluator
 * escalates tools aimed at these; multi-file tools (RenameSymbol) refuse them.
 */
export function isSensitiveFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return DEFAULT_SENSITIVE_PATTERNS.some(pattern => minimatch(basename, pattern, { dot: true }));
}
