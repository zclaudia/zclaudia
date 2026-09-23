/**
 * Cross-session message delivery for the SendMessage / RespondToCoordinator
 * tools, implemented over the active-run registry.
 *
 * Two delivery styles, mirroring the two existing precedents:
 * - `steer` behaves like a UI steer (handlers/run.ts handleRunSteer): the
 *   text becomes a persisted, broadcast user message in the target session
 *   and lands in the live agent's steering queue.
 * - `notify` behaves like a background-task settlement notice
 *   (task-settlement-notifier.ts): steered as an unpersisted system reminder
 *   when a run is live, otherwise queued for the session's next run.
 */
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { MessageAppendedMessage } from '@zclaudia/shared/wire/messages';
import type { SubagentMessenger } from '../../../infra/providers/types.js';
import type { ActiveRun } from '../transport/types.js';
import { broadcastRunMessage } from '../transport/broadcast.js';
import { isTerminalPhase } from './active-run-phase.js';
import { addPendingTaskNotice } from './pending-task-notices.js';
import { persistSteeredUserMessage } from './steer-persistence.js';

export interface SubagentMessengerDeps {
  activeRuns: Map<string, ActiveRun>;
}

export function findActiveRunForSession(
  activeRuns: Map<string, ActiveRun>,
  sessionId: string
): ActiveRun | undefined {
  for (const run of activeRuns.values()) {
    if (run.sessionId === sessionId && !isTerminalPhase(run.phase)) return run;
  }
  return undefined;
}

export function createSubagentMessenger(deps: SubagentMessengerDeps): SubagentMessenger {
  return {
    steer(sessionId, text) {
      const trimmed = text.trim();
      const run = findActiveRunForSession(deps.activeRuns, sessionId);
      if (!run) return { delivery: 'no_active_run' };
      if (!run.steerHandle) return { delivery: 'not_ready' };

      // Monotonic per run so the derived message id never collides (same
      // guarantee handleRunSteer relies on).
      const now = Math.max(Date.now(), (run.lastSteerAt ?? 0) + 1);
      run.lastSteerAt = now;
      const agentMessage: AgentMessage = {
        role: 'user',
        content: [{ type: 'text', text: trimmed }],
        timestamp: now,
      };
      run.steerHandle.steer(agentMessage);

      const steerMessageId = `steer-${run.runId}-${now}`;
      try {
        if (run.db) {
          persistSteeredUserMessage(run.db, {
            id: steerMessageId,
            sessionId: run.sessionId,
            content: trimmed,
            createdAt: now,
          });
        }
      } catch (err) {
        // The agent already accepted the steer; a persistence gap is logged,
        // not fatal (same policy as handleRunSteer).
        console.error('[subagent-messenger] failed to persist steered message:', err);
      }
      run.pendingSteers.push(agentMessage);
      broadcastRunMessage(run, {
        type: 'message_appended',
        sessionId: run.sessionId,
        runId: run.runId,
        role: 'user',
        content: trimmed,
        steered: true,
        timestamp: now,
      } as MessageAppendedMessage);
      return { delivery: 'steered' };
    },

    notify(sessionId, text) {
      const run = findActiveRunForSession(deps.activeRuns, sessionId);
      if (run?.steerHandle) {
        try {
          run.steerHandle.steer({
            role: 'user',
            content: [{ type: 'text', text }],
            timestamp: Date.now(),
          });
          return { delivery: 'steered' };
        } catch (err) {
          console.warn('[subagent-messenger] steer failed, queueing notice instead:', err);
        }
      }
      addPendingTaskNotice(sessionId, text);
      return { delivery: 'queued' };
    },
  };
}
