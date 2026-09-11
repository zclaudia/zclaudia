import { resolveExecutableFromPath, type ResolveExecutableOptions } from '@zclaudia/agent-common';

export type ResolveCursorCliOptions = ResolveExecutableOptions;

/**
 * Locate a `cursor-agent` executable on the given PATH string, mimicking how a shell
 * would resolve the command: scan directories in order and return the first
 * matching executable. Returns undefined when none is found so callers can fall
 * back to the SDK-bundled binary.
 */
export function resolveCursorCliFromPath(
  pathEnv: string | undefined,
  options: ResolveCursorCliOptions = {}
): string | undefined {
  return resolveExecutableFromPath('cursor-agent', pathEnv, options);
}
