import type { initDatabase } from '../../infra/storage/db.js';

/**
 * Real project root lookup (G5a). Returns the projects.root_path string.
 * Throws if project is missing or has no root_path configured.
 */
export function getProjectRoot(
  db: ReturnType<typeof initDatabase>,
  projectId: string
): string {
  const row = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId) as
    | { root_path: string | null }
    | undefined;
  if (!row) {
    throw new Error(`Project not found: ${projectId}`);
  }
  if (!row.root_path) {
    throw new Error(
      `Project ${projectId} has no root_path configured (set via PATCH /api/projects/:id { rootPath })`
    );
  }
  return row.root_path;
}
