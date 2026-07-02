import { Bot } from 'lucide-react';

interface ProjectWorkspaceItemProps {
  onSelect: () => void;
  isSelected: boolean;
  isActive?: boolean;
  taskCount: number;
  taskChildren: React.ReactNode;
}

/**
 * Lightweight Project Workspace row, styled to sit at the same visual weight as
 * the worktree/session rows below it. Clicking opens the project workspace
 * (project-level operations: tasks, issues, worktrees, git, etc.). The
 * supervisor phase is surfaced as a status dot on the project header row; task
 * sessions are listed directly below.
 */
export function ProjectWorkspaceItem({
  onSelect,
  isSelected,
  isActive,
  taskCount,
  taskChildren,
}: ProjectWorkspaceItemProps) {
  return (
    <div className="relative" data-testid="supervisor-group">
      <button
        onClick={onSelect}
        className={`w-full flex items-center gap-1.5 px-1 h-7 rounded-md transition-colors ${
          isSelected
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
        }`}
      >
        <Bot className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
        <span className="text-xs font-medium truncate">Project Workspace</span>
        {isActive && (
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
        )}
        {taskCount > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground/60 shrink-0">
            {taskCount} task{taskCount > 1 ? 's' : ''}
          </span>
        )}
      </button>

      {/* Task sessions — shown directly under supervisor */}
      {taskCount > 0 && <div className="mt-0.5 pl-2">{taskChildren}</div>}
    </div>
  );
}
