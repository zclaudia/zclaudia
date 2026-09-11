import { resolveExecutableFromPath, type ResolveExecutableOptions } from '@zclaudia/agent-common';

/**
 * Resolve the codex CLI executable.
 * If an explicit path is provided, it is returned.
 * Otherwise, it searches for 'codex' (or 'codex.exe' on Windows) in the PATH.
 */
export function resolveCodexCli(
  explicitPath?: string,
  pathEnv: string | undefined = process.env.PATH,
  options: ResolveExecutableOptions = {}
): string | undefined {
  return explicitPath ?? resolveExecutableFromPath('codex', pathEnv, options);
}
