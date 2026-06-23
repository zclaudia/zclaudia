import { FileEdit, FileText, FileDiff, Terminal as TerminalIcon, GitFork, type LucideIcon } from 'lucide-react';

/** Maps a SessionTool.iconKey to its Lucide icon. Shared by RightSidebar and
 *  RightSidebarEmptyState (kept out of RightSidebar.tsx to avoid an import cycle). */
export const TOOL_ICONS: Record<string, LucideIcon> = {
  draft: FileEdit,
  file: FileText,
  changes: FileDiff,
  terminal: TerminalIcon,
  lineage: GitFork,
};
