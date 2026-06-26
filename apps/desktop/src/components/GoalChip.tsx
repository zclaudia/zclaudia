import type { Goal } from '@zclaudia/shared';

interface GoalChipProps {
  goal: Goal | null;
  onOpen: () => void;
  onPauseResume: () => void;
}

function truncate(text: string, n: number): string {
  return text.length > n ? text.slice(0, n - 1) + '…' : text;
}

export function GoalChip({ goal, onOpen, onPauseResume }: GoalChipProps) {
  if (!goal) {
    return (
      <button
        type="button"
        onClick={onOpen}
        data-testid="goal-chip"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium h-7 transition-colors bg-accent text-accent-foreground hover:bg-accent/80 border border-dashed border-border cursor-pointer"
      >
        + Set goal
      </button>
    );
  }

  const terminal =
    goal.status === 'completed' ||
    goal.status === 'budget-limited' ||
    goal.status === 'aborted';

  if (terminal) {
    const label =
      goal.status === 'completed'
        ? 'Goal completed'
        : goal.status === 'budget-limited'
        ? 'Budget reached'
        : 'Goal cleared';
    return (
      <div
        data-testid="goal-chip"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium h-7 bg-accent text-accent-foreground"
        title={goal.endReason ?? undefined}
      >
        <span className="font-medium">{label}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="text-muted-foreground hover:text-foreground leading-none"
          aria-label="open goal settings"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="goal-chip"
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium h-7 bg-accent text-accent-foreground hover:bg-accent/80 cursor-pointer transition-colors"
      onClick={onOpen}
      title={goal.lastVerdictReason ?? undefined}
    >
      <span>{truncate(goal.objective, 40)}</span>
      <span className="text-muted-foreground">
        · {goal.turnsUsed}/{goal.maxTurns}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPauseResume();
        }}
        className="ml-1 text-muted-foreground hover:text-foreground"
        aria-label={goal.status === 'paused' ? 'resume' : 'pause'}
      >
        {goal.status === 'paused' ? '▶' : '⏸'}
      </button>
    </div>
  );
}
