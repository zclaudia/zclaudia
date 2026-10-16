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

/**
 * The directories a tool may touch: relative paths resolve against `primary`;
 * absolute paths (or `..` hops) may land in `primary` or any `additional` root.
 */
export interface WorkspaceRoots {
  primary: string;
  additional?: readonly string[];
}

/** True when `resolved` is inside `workspace` lexically and after following symlinks. */
function isInsideRoot(workspace: string, resolved: string): boolean {
  const relative = path.relative(workspace, resolved);
  if (isOutsideWorkspace(relative)) return false;
  let realWorkspace: string;
  try {
    realWorkspace = realpath(workspace);
  } catch {
    return false;
  }
  let probe = resolved;
  const missingParts: string[] = [];
  while (!existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    missingParts.unshift(path.basename(probe));
    probe = parent;
  }
  if (!existsSync(probe)) return false;
  const realExistingPrefix = realpath(probe);
  if (isOutsideWorkspace(path.relative(realWorkspace, realExistingPrefix))) return false;
  const realCandidate =
    missingParts.length > 0 ? path.join(realExistingPrefix, ...missingParts) : realExistingPrefix;
  return !isOutsideWorkspace(path.relative(realWorkspace, realCandidate));
}

/** Tool options that carry the project's additional directories. */
export interface WorkspaceRootOptions {
  additionalRoots?: readonly string[];
}

/** Build the root set a tool resolves paths against from its `cwd` and options. */
export function workspaceRootsOf(cwd: string, options?: WorkspaceRootOptions): WorkspaceRoots {
  return { primary: cwd, additional: options?.additionalRoots };
}

export function resolveInsideWorkspaces(roots: WorkspaceRoots, requestedPath: unknown): string {
  const rawPath =
    typeof requestedPath === 'string' && requestedPath.trim() ? requestedPath.trim() : '.';
  const primary = path.resolve(roots.primary);
  const resolved = path.resolve(primary, rawPath);
  const additional = (roots.additional ?? []).map(root => path.resolve(root));
  for (const workspace of [primary, ...additional]) {
    if (isInsideRoot(workspace, resolved)) return resolved;
  }
  if (additional.length === 0) {
    throw new Error(`Path is outside workspace: ${rawPath}`);
  }
  throw new Error(
    `Path is outside workspace: ${rawPath}. Allowed roots: ${[primary, ...additional].join(', ')}`
  );
}

/**
 * Resolve a path for a feature that only works under the primary root (language
 * servers). A path inside a configured additional directory is refused with an
 * explicit explanation instead of a generic "outside workspace" error.
 */
export function resolveInsidePrimaryWorkspace(
  roots: WorkspaceRoots,
  requestedPath: unknown,
  feature: string
): string {
  try {
    return resolveInsideWorkspaces({ primary: roots.primary }, requestedPath);
  } catch (err) {
    if ((roots.additional?.length ?? 0) > 0) {
      let inAdditional = true;
      try {
        resolveInsideWorkspaces(roots, requestedPath);
      } catch {
        inAdditional = false;
      }
      if (inAdditional) {
        throw new Error(
          `${feature} only supports files under the primary workspace root (${path.resolve(roots.primary)}); ` +
            `${String(requestedPath)} is in an additional directory, which has no language server.`
        );
      }
    }
    throw err;
  }
}

export function resolveInsideWorkspace(cwd: string, requestedPath: unknown): string {
  return resolveInsideWorkspaces({ primary: cwd }, requestedPath);
}

export function toWorkspaceRelative(cwd: string, filePath: string): string {
  return path.relative(cwd, path.resolve(filePath)).split(path.sep).join('/');
}
