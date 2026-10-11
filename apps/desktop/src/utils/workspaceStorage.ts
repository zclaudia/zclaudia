export const sessionWorkspaceId = (sessionId: string): string => JSON.stringify(['session-workspace', sessionId]);

/** Chosen during store creation, before persist hydration or any window edits. */
export function workspaceStorageKey(baseName: string, search: string): string {
  const params = new URLSearchParams(search);
  const sessionId = params.get('sessionWindow');
  if (sessionId) return `${baseName}:session:${encodeURIComponent(sessionId)}`;
  const projectId = params.get('projectDashboard');
  return projectId ? `${baseName}:dashboard:${encodeURIComponent(projectId)}` : baseName;
}
