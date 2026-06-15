/**
 * Project ids owned by `backendId`. Projects with no known owner are attributed
 * to the local backend so they always have a home in the tree.
 */
export function selectProjectIdsForBackend<T extends { id: string }>(
  projects: T[],
  backendId: string,
  getProjectBackendId: (projectId: string) => string | null,
  localBackendId: string | null,
): string[] {
  return projects
    .filter((p) => (getProjectBackendId(p.id) ?? localBackendId) === backendId)
    .map((p) => p.id);
}
