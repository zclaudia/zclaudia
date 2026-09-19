// Public entry for the local-issues feature.
// Cross-feature consumers must import from here instead of internal files.
export { useLocalIssueStore } from './store';
export { CreateIssueDialog } from './components/CreateIssueDialog';
export { LocalIssuesPanel } from './components/LocalIssuesPanel';
