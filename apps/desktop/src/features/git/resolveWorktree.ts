/**
 * Resolves the worktree path a session-aware git panel should operate on.
 * Precedence: explicit user override → session working directory → project root.
 * Returns null when none is available.
 *
 * Blank values count as absent: the server persists `working_directory` as
 * NULL, but partial wire payloads and the project cache can carry `''`, which
 * would otherwise shadow a real project root.
 */
function normalizeWorktreePath(path: string | null | undefined): string | null {
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveEffectiveWorktree(
  override: string | null | undefined,
  workingDirectory: string | null | undefined,
  projectRoot: string | null | undefined
): string | null {
  return (
    normalizeWorktreePath(override) ??
    normalizeWorktreePath(workingDirectory) ??
    normalizeWorktreePath(projectRoot)
  );
}
