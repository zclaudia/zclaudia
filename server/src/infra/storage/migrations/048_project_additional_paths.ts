import type { Migration } from './types.js';

/**
 * Additional project directories (docs/plans/2026-10-16-multi-directory-projects-plan.md):
 * a JSON array of absolute paths the agent may read/write beside the primary
 * `root_path`. NULL means none.
 */
export const migration: Migration = {
  name: '048_project_additional_paths',
  sql: `
ALTER TABLE projects ADD COLUMN additional_paths TEXT;
  `,
  idempotent: true,
};
