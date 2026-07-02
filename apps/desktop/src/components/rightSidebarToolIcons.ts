import {
  FileEdit,
  FileText,
  FileDiff,
  Terminal as TerminalIcon,
  GitFork,
  Brain,
  GitBranch,
  PanelTop,
  type LucideIcon,
} from 'lucide-react';

/** Maps a SessionTool.iconKey to its Lucide icon. Shared by RightSidebar and
 *  RightSidebarEmptyState (kept out of RightSidebar.tsx to avoid an import cycle). */
export const TOOL_ICONS: Record<string, LucideIcon> = {
  draft: FileEdit,
  file: FileText,
  changes: FileDiff,
  terminal: TerminalIcon,
  lineage: GitFork,
  memory: Brain,
  git: GitBranch,
};

/** Panel id → iconKey (kept in sync with RightSidebarEmptyState's PANEL_ICON_MAP). */
const PANEL_ICON_KEY: Record<string, keyof typeof TOOL_ICONS> = {
  draft: 'draft',
  'file-viewer': 'file',
  'session-changes': 'changes',
  terminal: 'terminal',
  lineage: 'lineage',
  memory: 'memory',
  git: 'git',
};

/** Resolve a Lucide icon for a panel id, with a neutral fallback. */
export function iconForPanel(panelId: string): LucideIcon {
  const key = PANEL_ICON_KEY[panelId];
  return (key && TOOL_ICONS[key]) || PanelTop;
}
