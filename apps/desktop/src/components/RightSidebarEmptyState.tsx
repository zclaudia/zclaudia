import { GitBranch, FileDiff } from 'lucide-react';
import { TOOL_ICONS } from './rightSidebarToolIcons';
import { useSessionToolsStore, type SessionTool } from '../stores/sessionToolsStore';
import { useGitStore } from '../features/git/store';
import { useSelectionStore } from '../stores/selectionStore';
import { useChangesData } from './changes/useSessionChanges';

interface RightSidebarEmptyStateProps {
  projectId: string | undefined;
  projectRoot: string | undefined;
}

/** Static subtitle per tool iconKey. The 'changes' tile is dynamic (count) and
 *  handled in render, so it is intentionally absent here. The `satisfies` clause
 *  makes the compiler flag drift if a new iconKey is added to the union. */
const SUBTITLES = {
  draft: '编辑草稿',
  file: '浏览工作目录',
  terminal: '运行命令',
  lineage: '会话分支图',
} satisfies Record<Exclude<SessionTool['iconKey'], 'changes'>, string>;

/**
 * Default content for the right sidebar when it is expanded (pinned tools exist)
 * but no panel is open. Shows a compact git-branch + session-changes status line
 * and a launcher tile per pinned tool, reusing each tool's existing onClick.
 */
export function RightSidebarEmptyState({ projectId, projectRoot }: RightSidebarEmptyStateProps) {
  const tools = useSessionToolsStore((s) => s.tools);
  const sessionId = useSelectionStore((s) => s.selectedSessionId);
  const branch = useGitStore((s) => {
    if (!projectId) return undefined;
    const selectedPath = s.selectedWorktree[projectId];
    return (s.worktrees[projectId] ?? []).find((w) => w.path === selectedPath)?.branch;
  });
  const { result } = useChangesData(sessionId, null, projectRoot);
  const changedCount = result.modified.length;

  const orderedTools: SessionTool[] = changedCount > 0
    ? [...tools.filter((t) => t.iconKey === 'changes'), ...tools.filter((t) => t.iconKey !== 'changes')]
    : tools;

  const showStatus = !!branch || changedCount > 0;

  const subtitleFor = (tool: SessionTool): string | undefined => {
    if (tool.iconKey === 'changes') {
      return changedCount > 0 ? `${changedCount} 个文件待查看` : '查看本次会话改动';
    }
    return SUBTITLES[tool.iconKey];
  };

  return (
    <div className="h-full overflow-y-auto p-3">
      {showStatus && (
        <div className="flex items-center gap-2 mb-3 px-2.5 py-1.5 rounded-md bg-secondary text-xs text-muted-foreground">
          {branch && (
            <span className="flex items-center gap-1.5 min-w-0">
              <GitBranch className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="text-foreground font-medium truncate">{branch}</span>
            </span>
          )}
          {changedCount > 0 && (
            <span className="flex items-center gap-1 ml-auto text-warning flex-shrink-0">
              <FileDiff className="w-3 h-3" />
              {changedCount}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {orderedTools.map((tool) => {
          const Icon = TOOL_ICONS[tool.iconKey];
          const subtitle = subtitleFor(tool);
          return (
            <button
              key={tool.id}
              onClick={tool.onClick}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-md border border-border text-left hover:bg-secondary"
            >
              {Icon && <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
              <span className="min-w-0">
                <span data-testid="empty-tile-label" className="block text-[13px] font-medium text-foreground truncate">
                  {tool.label}
                </span>
                {subtitle && (
                  <span className="block text-[11px] text-muted-foreground truncate">{subtitle}</span>
                )}
              </span>
              {tool.hasBadge && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
