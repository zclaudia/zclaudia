// Shared selection types. Kept in a dedicated module so selectionStore and
// projectStore can both use them without importing each other.
export type ProjectDashboardView =
  | 'home'
  | 'tasks'
  | 'local-prs'
  | 'issues'
  | 'spec'
  | 'supervisor'
  | 'git';
