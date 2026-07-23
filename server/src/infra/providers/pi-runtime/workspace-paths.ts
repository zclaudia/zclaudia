import * as path from 'path';
import { existsSync, realpathSync } from 'fs';

function realpath(filePath: string): string {
  return realpathSync.native?.(filePath) ?? realpathSync(filePath);
}

/**
 * True when a path relative to the workspace root escapes it. A bare
 * `startsWith('..')` would misfire on legitimate in-workspace names like
 * `..data` or `...config`, so only `..` itself or a `../` (`..\`) prefix
 * counts as an escape.
 */
export function isOutsideWorkspace(relative: string): boolean {
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function assertInside(realWorkspace: string, candidate: string, rawPath: string): void {
  const relative = path.relative(realWorkspace, candidate);
  if (isOutsideWorkspace(relative)) {
    throw new Error(`Path is outside workspace: ${rawPath}`);
  }
}

export function resolveInsideWorkspace(cwd: string, requestedPath: unknown): string {
  const rawPath =
    typeof requestedPath === 'string' && requestedPath.trim() ? requestedPath.trim() : '.';
  const workspace = path.resolve(cwd);
  const resolved = path.resolve(workspace, rawPath);
  const relative = path.relative(workspace, resolved);
  if (isOutsideWorkspace(relative)) {
    throw new Error(`Path is outside workspace: ${rawPath}`);
  }
  const realWorkspace = realpath(workspace);
  let probe = resolved;
  const missingParts: string[] = [];
  while (!existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    missingParts.unshift(path.basename(probe));
    probe = parent;
  }
  if (!existsSync(probe)) {
    throw new Error(`Path is outside workspace: ${rawPath}`);
  }
  const realExistingPrefix = realpath(probe);
  assertInside(realWorkspace, realExistingPrefix, rawPath);
  const realCandidate =
    missingParts.length > 0 ? path.join(realExistingPrefix, ...missingParts) : realExistingPrefix;
  assertInside(realWorkspace, realCandidate, rawPath);
  return resolved;
}

export function toWorkspaceRelative(cwd: string, filePath: string): string {
  return path.relative(cwd, path.resolve(filePath)).split(path.sep).join('/');
}
