import * as fs from 'node:fs';
import * as path from 'node:path';

/** Resolve symlinks through the deepest existing ancestor, keeping missing tail segments. */
function realPathWithMissingTail(target: string): string {
  const missing: string[] = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...missing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function isWithin(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

/**
 * True when the absolute `target` is inside one of `roots`, both lexically
 * (so `root/../x` and `root-sibling` do not pass) and after following symlinks
 * (so a link inside a root cannot lead out of it). Relative targets never match.
 */
export function isInsideAnyRoot(target: string, roots: readonly string[]): boolean {
  if (!path.isAbsolute(target)) return false;
  const lexical = path.resolve(target);
  return roots.some(root => {
    if (!path.isAbsolute(root)) return false;
    const resolvedRoot = path.resolve(root);
    return (
      isWithin(lexical, resolvedRoot) &&
      isWithin(realPathWithMissingTail(lexical), realPathWithMissingTail(resolvedRoot))
    );
  });
}
