import type { Goal } from '@zclaudia/shared';
import { Target, Pause, Play, X, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface GoalPinnedBarProps {
  goal: Goal | null;
  // Live budget counts, intentionally separate from `goal`. The goal store updates
  // `budgetTokensUsed`/`budgetTurnsUsed` via `goal:budget-update` WS messages between
  // state changes, so `goal.tokensUsed`/`goal.turnsUsed` would be stale here.
  tokensUsed: number;
  turnsUsed: number;
  onOpen: () => void;
  onPauseResume: () => void;
  onClear: () => void;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function Meter({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const right = label === 'Tokens' ? `${fmtTokens(used)} / ${fmtTokens(total)}` : `${used} / ${total}`;
  return (
    <div className="flex-1 max-w-[220px]">
      <div className="flex justify-between text-[11px] text-muted-foreground mb-0.5">
        <span>{label}</span>
        <span>{right}</span>
      </div>
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function GoalPinnedBar({ goal, tokensUsed, turnsUsed, onOpen, onPauseResume, onClear }: GoalPinnedBarProps) {
  if (!goal) return null;

  const terminal = goal.status === 'completed' || goal.status === 'budget-limited' || goal.status === 'aborted';

  if (terminal) {
    const completed = goal.status === 'completed';
    const label = completed ? 'Goal completed' : goal.status === 'budget-limited' ? 'Budget reached' : 'Goal cleared';
    return (
      <div
        data-testid="goal-pinned-bar"
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-secondary/50 text-sm"
        title={goal.endReason ?? undefined}
      >
        {completed ? (
          <CheckCircle2 size={16} className="text-primary shrink-0" />
        ) : (
          <AlertTriangle size={16} className="text-muted-foreground shrink-0" />
        )}
        <span className="flex-1 truncate font-medium text-muted-foreground">{goal.objective}</span>
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">{label}</span>
        <button type="button" onClick={onClear} aria-label="Dismiss goal" className="text-muted-foreground hover:text-foreground">
          <X size={15} />
        </button>
      </div>
    );
  }

  const paused = goal.status === 'paused';

  return (
    <div
      data-testid="goal-pinned-bar"
      className="px-3 py-2 rounded-lg border border-border bg-secondary/50"
    >
      <div className="flex items-center gap-2.5">
        <Target size={16} className={paused ? 'text-muted-foreground shrink-0' : 'text-primary shrink-0'} />
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 min-w-0 text-left text-sm font-medium truncate hover:underline"
          title="Edit goal"
          aria-label="Edit goal"
        >
          {goal.objective}
        </button>
        {paused && (
          <span className="text-[11px] text-muted-foreground bg-muted rounded-full px-2 py-0.5">Paused</span>
        )}
        <button
          type="button"
          onClick={onPauseResume}
          aria-label={paused ? 'Resume goal' : 'Pause goal'}
          className="text-muted-foreground hover:text-foreground"
        >
          {paused ? <Play size={15} /> : <Pause size={15} />}
        </button>
        <button type="button" onClick={onClear} aria-label="Clear goal" className="text-muted-foreground hover:text-foreground">
          <X size={15} />
        </button>
      </div>
      <div className="flex gap-4 mt-1.5 pl-[26px]">
        <Meter label="Turns" used={turnsUsed} total={goal.maxTurns} />
        <Meter label="Tokens" used={tokensUsed} total={goal.tokenBudget} />
      </div>
    </div>
  );
}
