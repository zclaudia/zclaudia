import * as path from 'path';

export function resolveInsideWorkspace(cwd: string, requestedPath: unknown): string {
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

export function toWorkspaceRelative(cwd: string, filePath: string): string {
  return path.relative(cwd, path.resolve(filePath)).split(path.sep).join('/');
}
