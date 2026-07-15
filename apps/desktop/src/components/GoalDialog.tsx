import { useState, useEffect, useRef } from 'react';
import type { Goal } from '@zclaudia/shared';
import { GOAL_DEFAULTS } from '@zclaudia/shared';
import { trapTab } from '../utils/focusTrap';

interface GoalDialogProps {
  goal: Goal | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (args: { objective: string; tokenBudget: number; maxTurns: number }) => void;
  onClear: () => void;
}

export function GoalDialog({ goal, open, onClose, onSubmit, onClear }: GoalDialogProps) {
  const [objective, setObjective] = useState(goal?.objective ?? '');
  const [tokenBudget, setTokenBudget] = useState(goal?.tokenBudget ?? GOAL_DEFAULTS.tokenBudget);
  const [maxTurns, setMaxTurns] = useState(goal?.maxTurns ?? GOAL_DEFAULTS.maxTurns);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset form when the goal changes (e.g., opening dialog for a different session).
  useEffect(() => {
    setObjective(goal?.objective ?? '');
    setTokenBudget(goal?.tokenBudget ?? GOAL_DEFAULTS.tokenBudget);
    setMaxTurns(goal?.maxTurns ?? GOAL_DEFAULTS.maxTurns);
  }, [goal?.id]);

  if (!open) return null;

  const active = !!goal && (goal.status === 'active' || goal.status === 'paused');
  const submitLabel = active ? 'Update' : 'Set goal';
  const disableSubmit = objective.trim().length === 0;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else {
      trapTab(e, dialogRef.current);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="bg-popover border border-border rounded-xl shadow-lg max-w-[440px] w-full mx-4"
        role="dialog"
        aria-modal="true"
        aria-label={active ? 'Update goal' : 'Set goal'}
      >
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-base font-semibold">{active ? 'Update goal' : 'Set goal'}</h3>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Objective</label>
            <textarea
              value={objective}
              onChange={e => setObjective(e.target.value)}
              maxLength={GOAL_DEFAULTS.objectiveMaxChars}
              rows={4}
              className="w-full text-sm px-2.5 py-1.5 rounded-md bg-input border border-border focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              placeholder="What does done look like? (e.g. all tests pass)"
              autoFocus
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-muted-foreground mb-1">Token budget</label>
              <input
                type="number"
                min={10000}
                max={10_000_000}
                step={10000}
                value={tokenBudget}
                onChange={e => setTokenBudget(Number(e.target.value))}
                className="w-full text-sm px-2.5 py-1.5 rounded-md bg-input border border-border focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-muted-foreground mb-1">Max turns</label>
              <input
                type="number"
                min={1}
                max={500}
                value={maxTurns}
                onChange={e => setMaxTurns(Number(e.target.value))}
                className="w-full text-sm px-2.5 py-1.5 rounded-md bg-input border border-border focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            The evaluator uses the same model as the agent.
          </p>
        </div>

        <div className="px-4 py-3 border-t border-border flex items-center gap-2">
          {active && (
            <button
              type="button"
              onClick={onClear}
              className="px-3 py-1.5 text-sm rounded-md bg-secondary hover:bg-secondary/80 text-destructive"
            >
              Clear goal
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-md bg-secondary hover:bg-secondary/80"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={disableSubmit}
              onClick={() => onSubmit({ objective: objective.trim(), tokenBudget, maxTurns })}
              className="px-3 py-1.5 text-sm rounded-md bg-muted/60 text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
