import type { Project } from '@zclaudia/shared/core/project';

/**
 * Read-only project lookup the workflow engine needs (root path for run cwd).
 * Implemented by the projects domain's repository; wired through the workflow
 * domain register function so workflows never imports projects directly.
 */
export interface ProjectLookupPort {
  findById(projectId: string): Project | null;
}
