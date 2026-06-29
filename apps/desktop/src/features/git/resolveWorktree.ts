/**
 * Resolves the worktree path a session-aware git panel should operate on.
 * Precedence: explicit user override → session working directory → project root.
 * Returns null when none is available.
 */
export function resolveEffectiveWorktree(
  override: string | null | undefined,
  workingDirectory: string | null | undefined,
  projectRoot: string | null | undefined,
): string | null {
  return override ?? workingDirectory ?? projectRoot ?? null;
}
