import { GitBranch, FileDiff } from 'lucide-react';
import { TOOL_ICONS } from './rightSidebarToolIcons';
import { usePluginStore, selectPluginPanels } from '../stores/pluginStore';
import { useGitStore } from '../features/git/store';
import { useChangesData } from './changes/useSessionChanges';
import { useServerStore } from '../stores/serverStore';
import { openToolInWorkspace } from '../utils/workspaceActions';

interface RightSidebarEmptyStateProps {
  sessionId: string;
  projectId: string | undefined;
  projectRoot: string | undefined;
}

type EmptyTile = { id: string; label: string; iconKey: 'draft' | 'file' | 'changes' | 'terminal' | 'lineage' };

/** Maps panel id → iconKey for the known 5 tool tiles. */
const PANEL_ICON_MAP: Record<string, EmptyTile['iconKey']> = {
  draft: 'draft',
  'file-viewer': 'file',
  'session-changes': 'changes',
  terminal: 'terminal',
  lineage: 'lineage',
};

/** Static subtitle per tool iconKey. The 'changes' tile is dynamic (count) and
 *  handled in render, so it is intentionally absent here. The `satisfies` clause
 *  makes the compiler flag drift if a new iconKey is added to the union. */
const SUBTITLES = {
  draft: 'Edit draft',
  file: 'Browse working directory',
  terminal: 'Run commands',
  lineage: 'Session branch graph',
} satisfies Record<Exclude<EmptyTile['iconKey'], 'changes'>, string>;

/**
 * Default content for the right sidebar when it is expanded but no panel is
 * open. Shows a compact git-branch + session-changes status line and a
 * launcher tile per known built-in panel, calling openToolInWorkspace on click.
 */
export function RightSidebarEmptyState({ sessionId, projectId, projectRoot }: RightSidebarEmptyStateProps) {
  const panels = usePluginStore(selectPluginPanels);
  const disabled = usePluginStore((s) => s.disabledBuiltinPanels);
  const backendId = useServerStore((s) => s.activeServerId);
  const branch = useGitStore((s) => {
    if (!projectId) return undefined;
    const selectedPath = s.selectedWorktree[projectId];
    return (s.worktrees[projectId] ?? []).find((w) => w.path === selectedPath)?.branch;
  });
  const { result } = useChangesData(sessionId, null, projectRoot);
  const changedCount = result.modified.length;

  // Build tiles from the registry: desktop panels, not disabled, with a known iconKey.
  const tiles: EmptyTile[] = panels
    .filter(
      (p) =>
        (p.platforms ?? ['desktop']).includes('desktop') &&
        !disabled.includes(p.id) &&
        PANEL_ICON_MAP[p.id] !== undefined,
    )
    .map((p) => ({ id: p.id, label: p.label, iconKey: PANEL_ICON_MAP[p.id] }));

  const orderedTiles: EmptyTile[] = changedCount > 0
    ? [...tiles.filter((t) => t.iconKey === 'changes'), ...tiles.filter((t) => t.iconKey !== 'changes')]
    : tiles;

  const showStatus = !!branch || changedCount > 0;

  const subtitleFor = (tile: EmptyTile): string | undefined => {
    if (tile.iconKey === 'changes') {
      return changedCount > 0
        ? `${changedCount} file${changedCount === 1 ? '' : 's'} to review`
        : 'View session changes';
    }
    return SUBTITLES[tile.iconKey];
  };

  return (
    <div className="h-full overflow-y-auto p-3 flex flex-col">
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

      <div className="flex-1 flex flex-col items-center justify-center gap-1.5">
        <div className="mb-2 text-center px-2">
          <p className="text-sm font-medium text-foreground">Open a tool</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Pick a tool below to open it in the workspace</p>
        </div>
        {orderedTiles.map((tile) => {
          const Icon = TOOL_ICONS[tile.iconKey];
          const subtitle = subtitleFor(tile);
          return (
            <button
              key={tile.id}
              onClick={() => openToolInWorkspace(sessionId, tile.id, { projectId, backendId })}
              title={subtitle ?? undefined}
              className="flex items-center justify-center gap-1.5 w-full max-w-[220px] px-2.5 py-1.5 rounded-md border border-border hover:bg-secondary"
            >
              {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
              <span data-testid="empty-tile-label" className="text-xs font-medium text-foreground truncate">
                {tile.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
