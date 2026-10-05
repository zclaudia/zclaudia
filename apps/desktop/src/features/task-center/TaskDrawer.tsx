import { useEffect, useState } from 'react';
import { Bot, FileText, X } from 'lucide-react';
import type { BackgroundTask } from '../../stores/backgroundTaskStore';
import type { ToolCallState } from '../../stores/runStore';
import { SECTION_LABEL } from '../../components/ui/typography';
import { Button, IconButton } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { getToolIcon } from '../../config/icons';
import { getToolCallSummary } from '../chat/tool-call/ToolCallList';
import type { SubagentDetail } from './useSubagentDetail';

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Live-ish duration: usage settles at completion; while running, tick from startedAt. */
function useDuration(task: BackgroundTask): string {
  const isRunning = task.status === 'started' || task.status === 'in_progress';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isRunning]);
  if (task.usage?.duration_ms) return formatDuration(task.usage.duration_ms);
  return formatDuration((isRunning ? now : (task.completedAt ?? now)) - task.startedAt);
}

function usageStats(task: BackgroundTask, duration: string): string[] {
  const stats = [duration];
  const tokens = task.usage?.total_tokens ?? 0;
  if (tokens > 0) stats.push(tokens >= 1000 ? `${Math.round(tokens / 1000)}k tokens` : `${tokens} tokens`);
  if ((task.usage?.tool_uses ?? 0) > 0) stats.push(`${task.usage!.tool_uses} tool calls`);
  return stats;
}

export interface TaskDrawerProps {
  task: BackgroundTask;
  detail: SubagentDetail | null;
  /** Inner tool steps of the sub-agent (P5 lineage), oldest first. */
  steps?: ToolCallState[];
  /** Present only when the task can actually be stopped (running + stoppable). */
  onStop?: (task: BackgroundTask) => void;
  onClose: () => void;
}

function StepDot({ status }: { status: ToolCallState['status'] }) {
  if (status === 'running') {
    return <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" />;
  }
  if (status === 'error') {
    return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />;
  }
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />;
}

/**
 * One inner step of the sub-agent: status dot, tool icon, name, and the
 * one-line argument summary the transcript's collapsed rows also use.
 */
function StepRow({ step }: { step: ToolCallState }) {
  return (
    <li className="flex items-center gap-2 py-0.5 text-xs">
      <StepDot status={step.status} />
      <span className="shrink-0 text-muted-foreground">
        <Icon icon={getToolIcon(step.toolName)} size={11} />
      </span>
      <span className={step.status === 'running' ? 'text-foreground' : 'text-muted-foreground'}>
        {step.toolName}
      </span>
      <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/70">
        {getToolCallSummary(step)}
      </span>
    </li>
  );
}

/**
 * Sub-agent detail surface: what the agent was asked to do, the inner
 * step-by-step tool stream (P5 lineage; resolvable live from the run and,
 * once the run finalizes, from the session's persisted messages), and what
 * it came back with. Purely presentational; the host resolves stores and
 * positioning.
 */
export function TaskDrawer({ task, detail, steps = [], onStop, onClose }: TaskDrawerProps) {
  const duration = useDuration(task);
  const isRunning = task.status === 'started' || task.status === 'in_progress';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const summary = task.summary || detail?.resultText;

  return (
    <div
      role="dialog"
      aria-label="Sub-agent detail"
      className="fixed inset-y-0 right-0 z-modal flex w-[380px] max-w-full flex-col border-l border-border bg-popover shadow-xl animate-in slide-in-from-right duration-200"
    >
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-3">
        <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-[var(--radius-inline-token)] border border-border px-1.5 text-[11px] font-medium text-muted-foreground">
          <Bot size={11} strokeWidth={1.75} />
          {task.agentType ?? 'agent'}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
          {task.description || 'Sub-agent'}
        </span>
        {onStop && (
          <Button variant="destructive" size="sm" onClick={() => onStop(task)}>
            Stop
          </Button>
        )}
        <IconButton aria-label="Close sub-agent detail" onClick={onClose}>
          <X size={16} strokeWidth={1.75} />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3.5 py-3">
        {isRunning && task.activity && (
          <section>
            <h5 className={`${SECTION_LABEL} pb-1`}>Activity</h5>
            <p className="flex items-center gap-2 text-xs text-foreground">
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
              <span className="truncate">{task.activity}</span>
            </p>
          </section>
        )}

        {steps.length > 0 && (
          <section>
            <h5 className={`${SECTION_LABEL} pb-1`}>Steps · {steps.length}</h5>
            <ol className="flex flex-col">
              {steps.map(step => (
                <StepRow key={step.id} step={step} />
              ))}
            </ol>
          </section>
        )}

        {detail?.prompt && (
          <section>
            <h5 className={`${SECTION_LABEL} pb-1`}>Prompt</h5>
            <p className="max-h-44 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {detail.prompt}
            </p>
          </section>
        )}

        {summary && (
          <section>
            <h5 className={`${SECTION_LABEL} pb-1`}>{isRunning ? 'Notes' : 'Result'}</h5>
            <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {summary}
            </p>
          </section>
        )}

        {task.outputFile && (
          <section>
            <h5 className={`${SECTION_LABEL} pb-1`}>Output</h5>
            <span
              className="inline-flex h-[22px] items-center gap-1 rounded-[var(--radius-inline-token)] bg-primary/10 px-1.5 text-[11px] text-primary"
              title={task.outputFile}
            >
              <FileText size={11} strokeWidth={1.75} />
              <span className="max-w-[280px] truncate">{task.outputFile.split('/').pop()}</span>
            </span>
          </section>
        )}
      </div>

      <div className="border-t border-border px-3.5 py-2.5 text-[11px] text-muted-foreground">
        <span className={`${SECTION_LABEL} block pb-1`}>Usage</span>
        <div className="flex gap-4 tabular-nums">
          {usageStats(task, duration).map(stat => (
            <span key={stat}>{stat}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
