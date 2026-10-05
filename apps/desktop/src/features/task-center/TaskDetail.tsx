import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import type { BackgroundTask } from '../../stores/backgroundTaskStore';
import { getProcessInfo } from '../../services/api';

const STATUS_LABEL: Record<BackgroundTask['status'], string> = {
  started: 'Starting',
  in_progress: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
};

/**
 * Inline detail area under an expanded task row. Everything that used to
 * crowd the row itself lives here: the command, the PID block, and the
 * output-file reference. Process info is queried lazily — once, when the
 * detail first mounts — rather than on every row hover like the old PidBadge.
 */
export function TaskDetail({ task }: { task: BackgroundTask }) {
  const pid = task.taskRootPid ?? task.cliPid;
  const [processLine, setProcessLine] = useState<string | null>(null);

  useEffect(() => {
    if (!pid) return;
    let cancelled = false;
    getProcessInfo(pid, task.serverId)
      .then(info => {
        if (cancelled) return;
        if (info.alive) {
          const cmd = info.args || info.command || 'unknown';
          const elapsed = info.elapsedSeconds != null ? `${info.elapsedSeconds}s` : '?';
          setProcessLine(`PID ${info.pid} · running ${elapsed} · ${cmd}`);
        } else {
          setProcessLine(`PID ${info.pid} · exited`);
        }
      })
      .catch(() => {
        if (!cancelled) setProcessLine(`PID ${pid} · query failed`);
      });
    return () => {
      cancelled = true;
    };
  }, [pid, task.serverId]);

  return (
    <div className="mx-3 mb-2 ml-[38px] flex flex-col gap-1 rounded-md border border-border bg-background px-2.5 py-2 text-[11px]">
      {task.taskCommand && (
        <div className="flex gap-2">
          <span className="w-14 shrink-0 text-muted-foreground/60">Command</span>
          <span className="min-w-0 flex-1 truncate font-mono text-foreground" title={task.taskCommand}>
            $ {task.taskCommand}
          </span>
        </div>
      )}
      <div className="flex gap-2">
        <span className="w-14 shrink-0 text-muted-foreground/60">Status</span>
        <span className="min-w-0 flex-1 text-foreground">{STATUS_LABEL[task.status]}</span>
      </div>
      {processLine && (
        <div className="flex gap-2">
          <span className="w-14 shrink-0 text-muted-foreground/60">Process</span>
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground" title={processLine}>
            {processLine}
          </span>
        </div>
      )}
      {task.summary && (
        <div className="flex gap-2">
          <span className="w-14 shrink-0 text-muted-foreground/60">Summary</span>
          <span className="max-h-24 min-w-0 flex-1 overflow-y-auto leading-relaxed text-muted-foreground">
            {task.summary}
          </span>
        </div>
      )}
      {task.outputFile && (
        <div className="flex gap-2">
          <span className="w-14 shrink-0 text-muted-foreground/60">Output</span>
          <span
            className="inline-flex h-[18px] items-center gap-1 rounded-[var(--radius-inline-token)] bg-primary/10 px-1.5 text-primary"
            title={task.outputFile}
          >
            <FileText size={10} strokeWidth={1.75} />
            <span className="max-w-[260px] truncate">{task.outputFile.split('/').pop()}</span>
          </span>
        </div>
      )}
    </div>
  );
}
