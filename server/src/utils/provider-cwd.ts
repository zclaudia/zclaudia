/**
 * Decide the cwd a resumed provider run should use.
 *
 * The policy is declarative on the provider's runtime policy (`sessionCwdPolicy`):
 *   - `'pinned'`   → stick to the original session root for runtimes that
 *                    store sessions under work-dir-scoped storage
 *   - `'requested'` (default) → honour the caller's requested cwd
 *
 * No provider-type literals here; callers pass the runtime policy explicitly.
 */
export function resolveProviderCwd(options: {
  sessionCwdPolicy?: 'pinned' | 'requested';
  sdkSessionId?: string;
  requestedCwd: string;
  sessionRootPath?: string | null;
  persistedWorkingDirectory?: string | null;
}): string {
  const {
    sessionCwdPolicy,
    sdkSessionId,
    requestedCwd,
    sessionRootPath,
    persistedWorkingDirectory,
  } = options;

  if (sessionCwdPolicy === 'pinned' && sdkSessionId) {
    return sessionRootPath || persistedWorkingDirectory || requestedCwd;
  }

  return requestedCwd;
}
