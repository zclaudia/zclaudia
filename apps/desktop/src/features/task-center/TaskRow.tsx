import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  PauseCircle,
  ChevronDown,
  ChevronRight,
  Bot,
} from 'lucide-react';
import type { BackgroundTask } from '../../stores/backgroundTaskStore';
import { taskKind } from '../../stores/backgroundTaskStore';
import { Button } from '../../components/ui/Button';
import { TaskDetail } from './TaskDetail';

function formatTimeAgo(ts: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatUsage(task: BackgroundTask): string | null {
  if (!task.usage) return null;
  const parts: string[] = [];
  if (task.usage.total_tokens > 0) {
    const tokens = task.usage.total_tokens;
    parts.push(tokens >= 1000 ? `${Math.round(tokens / 1000)}k tok` : `${tokens} tok`);
  }
  if (task.usage.tool_uses > 0) parts.push(`${task.usage.tool_uses} tools`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function StatusIcon({ task }: { task: BackgroundTask }) {
  switch (task.status) {
    case 'started':
    case 'in_progress':
      return (
        <Loader2 size={13} strokeWidth={1.75} className="shrink-0 animate-spin text-primary" />
      );
    case 'paused':
      return <PauseCircle size={13} strokeWidth={1.75} className="shrink-0 text-warning" />;
    case 'failed':
    case 'stopped':
      return <XCircle size={13} strokeWidth={1.75} className="shrink-0 text-destructive" />;
    case 'completed':
      return <CheckCircle2 size={13} strokeWidth={1.75} className="shrink-0 text-success" />;
  }
}

interface TaskRowProps {
  task: BackgroundTask;
  /** Show a session tag when the task belongs to another session. */
  isOtherSession: boolean;
  /** Session names by id, for the cross-session tag. Falls back to the id. */
  sessionLabel?: string;
  onStop: (task: BackgroundTask) => void;
  onDismiss: (taskId: string) => void;
  /** Jump to the owning session — only passed for cross-session rows. */
  onLocate?: (task: BackgroundTask) => void;
}

/**
 * One task row: status icon, description, meta (time ago + usage), and a
 * single hover-revealed action (Stop for running tasks — the row's one
 * accent per ui-conventions §5 — or Dismiss for terminal ones). PIDs live in
 * the expandable detail, never inline.
 */
export function TaskRow({ task, isOtherSession, sessionLabel, onStop, onDismiss, onLocate }: TaskRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = task.status === 'started' || task.status === 'in_progress';
  const canStop = isRunning && task.stoppable !== false;
  const hasDetail = !!(task.summary || task.taskCommand || task.outputFile || task.taskRootPid || task.cliPid);
  const usage = formatUsage(task);
  const isSubagent = taskKind(task) === 'subagent';
  // Sub-agent rows lead with their live activity ("what is the agent doing
  // right now"); shell tasks lead with elapsed time.
  const meta = [isRunning && task.activity ? task.activity : null, formatTimeAgo(task.startedAt), usage]
    .filter(Boolean)
    .join(' · ');

  return (
    <div>
      <div className="group flex h-7 items-center gap-2 px-3 text-xs hover:bg-secondary">
        <StatusIcon task={task} />
        <button
          onClick={() => hasDetail && setExpanded(v => !v)}
          className="flex min-w-0 flex-1 select-none items-center gap-1.5 text-left"
          disabled={!hasDetail}
        >
          {isSubagent && (
            <span className="inline-flex h-4 shrink-0 items-center gap-1 rounded-[var(--radius-inline-token)] border border-border px-1 text-[10px] font-medium text-muted-foreground">
              <Bot size={9} strokeWidth={1.75} />
              {task.agentType ?? 'agent'}
            </span>
          )}
          <span className={`truncate ${isRunning ? 'text-foreground' : 'text-muted-foreground'}`}>
            {task.description || 'Background Task'}
          </span>
          {isOtherSession && sessionLabel && (
            <span className="shrink-0 rounded-[var(--radius-inline-token)] border border-border px-1 text-[10px] text-muted-foreground">
              {sessionLabel}
            </span>
          )}
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums group-hover:hidden">
            {meta}
          </span>
          {hasDetail && (
            <span className="shrink-0 text-muted-foreground/40">
              {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </span>
          )}
        </button>
        <span className="hidden shrink-0 items-center gap-1 group-hover:flex">
          {onLocate && (
            <Button variant="ghost" size="sm" onClick={() => onLocate(task)}>
              Open
            </Button>
          )}
          {canStop ? (
            <Button variant="destructive" size="sm" onClick={() => onStop(task)}>
              Stop
            </Button>
          ) : !isRunning ? (
            <Button variant="ghost" size="sm" onClick={() => onDismiss(task.id)}>
              Dismiss
            </Button>
          ) : null}
        </span>
      </div>
      {expanded && hasDetail && <TaskDetail task={task} />}
    </div>
  );
}
