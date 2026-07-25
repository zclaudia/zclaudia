// apps/desktop/src/features/meta-workflow/components/PhaseCard.tsx
import React from 'react';
import type { MetaWorkflowPhase } from '@zclaudia/shared/features/meta-workflow';
import { TONE_BADGE, type Tone } from '../../../components/ui/tone.js';
import {
  sendRunPhase,
  sendRerunPhase,
  sendIgnoreStale,
  sendEvaluateImpact,
  sendCascadeRerun,
} from '../api.js';

interface Props {
  runId: string;
  phase: MetaWorkflowPhase;
  socket: { send: (msg: string) => void };
  onClick: () => void;
}

const STATUS_TONES: Record<string, Tone> = {
  pending: 'neutral',
  searching_reuse: 'info',
  generating: 'info',
  ready_to_run: 'warning',
  running: 'success',
  verifying_gates: 'warning',
  done: 'success',
  failed: 'destructive',
  stale: 'warning',
};

export function PhaseCard({ runId, phase, socket, onClick }: Props): React.ReactElement {
  const colorClass = TONE_BADGE[STATUS_TONES[phase.status] ?? 'neutral'];
  const canRun = phase.status === 'pending';
  const canRerun = phase.status === 'done' || phase.status === 'failed' || phase.status === 'stale';
  const isStale = phase.status === 'stale';

  return (
    <div
      className="border border-border rounded-lg p-4 hover:shadow-sm hover:bg-secondary/30 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="font-medium">{phase.phaseId}</div>
          <div className="text-xs text-muted-foreground">
            {phase.phaseType} · {phase.executeEntity}
          </div>
        </div>
        <span className={`px-2 py-1 rounded-md text-xs font-mono ${colorClass}`}>
          {phase.status}
        </span>
      </div>
      <div className="text-xs text-muted-foreground mb-3">
        attempt {phase.attempt}/{phase.maxRetries}
      </div>
      <div className="flex gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
        {canRun && (
          <button
            className="px-2.5 py-1 text-xs rounded-md bg-muted/60 text-foreground hover:bg-muted"
            onClick={() => sendRunPhase(socket, { runId, phaseId: phase.phaseId })}
          >
            Run
          </button>
        )}
        {canRerun && (
          <button
            className="px-2.5 py-1 text-xs rounded-md bg-muted/60 text-foreground hover:bg-muted"
            onClick={() => sendRerunPhase(socket, { runId, phaseId: phase.phaseId })}
          >
            Re-run
          </button>
        )}
        {isStale && (
          <button
            className="px-2.5 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80"
            onClick={() => sendIgnoreStale(socket, { runId, phaseId: phase.phaseId })}
          >
            Ignore Stale
          </button>
        )}
        {canRerun && (
          <button
            className="px-2.5 py-1 text-xs rounded-md bg-purple-500/15 text-purple-600 hover:bg-purple-500/25"
            onClick={() => sendEvaluateImpact(socket, { runId, phaseId: phase.phaseId })}
          >
            Evaluate
          </button>
        )}
        {canRerun && (
          <button
            className="px-2.5 py-1 text-xs rounded-md bg-orange-500/15 text-orange-600 hover:bg-orange-500/25"
            onClick={() => sendCascadeRerun(socket, { runId, phaseId: phase.phaseId })}
          >
            Cascade
          </button>
        )}
      </div>
    </div>
  );
}
