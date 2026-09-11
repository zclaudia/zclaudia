import { existsSync } from 'node:fs';
import path from 'node:path';

export interface ResolveExecutableOptions {
  /** Platform to resolve for; defaults to the current process platform. */
  platform?: NodeJS.Platform;
  /** File-existence predicate; injectable for deterministic tests. */
  exists?: (candidate: string) => boolean;
}

/** Resolve a named executable from a PATH string using shell-compatible ordering. */
export function resolveExecutableFromPath(
  executable: string,
  pathEnv: string | undefined,
  options: ResolveExecutableOptions = {}
): string | undefined {
  if (!pathEnv) return undefined;

  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const isWindows = platform === 'win32';
  const pathMod = isWindows ? path.win32 : path.posix;
  const delimiter = isWindows ? ';' : ':';
  const candidates = isWindows
    ? [`${executable}.exe`, `${executable}.cmd`, `${executable}.bat`, executable]
    : [executable];

  for (const directory of pathEnv.split(delimiter)) {
    if (!directory) continue;
    for (const candidateName of candidates) {
      const candidate = pathMod.join(directory, candidateName);
      if (exists(candidate)) return candidate;
    }
  }

  return undefined;
}
