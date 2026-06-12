import type { AgentTool } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import type { PlanReviewInteractionMessage } from '@zclaudia/shared/interaction/forms';
import { interactionDispatcher } from '../../../application/conversation/interactions/interaction-dispatcher.js';
import { enterPlanMode as applyEnterPlanMode, exitPlanMode as applyExitPlanMode } from '../../../domains/sessions/plan-mode-toggle.js';
import { SessionRepository } from '../../../domains/sessions/repository.js';
import { errorResult, textResult } from './tool-common.js';

export interface ModeToolOptions {
  db?: Database.Database;
  sessionId?: string;
}

export function createEnterPlanModeTool(_cwd: string, options?: ModeToolOptions): AgentTool<any> {
  return {
    name: 'EnterPlanMode',
    label: 'EnterPlanMode',
    description: 'Switch the session into plan mode: analyze and design before changing anything. From your next turn on, only read-only tools are available. Produce a plan, then call ExitPlanMode (with the plan) for the user to approve before any changes are made.',
    parameters: { type: 'object', properties: {} } as any,
    execute: async (_toolCallId: string) => {
      const db = options?.db;
      const sessionId = options?.sessionId;
      if (!db || !sessionId) return errorResult('missing_session_context', 'EnterPlanMode requires session context');
      const result = applyEnterPlanMode(new SessionRepository(db), sessionId);
      if (!result.ok) return errorResult(result.error ?? 'enter_plan_failed', `Could not enter plan mode (${result.error}).`);
      return textResult(
        result.alreadyActive
          ? 'Already in plan mode. Read-only tools only until you call ExitPlanMode.'
          : 'Entered plan mode. Read-only enforcement applies from your next turn - produce a plan, then call ExitPlanMode with it for the user to approve.',
        { ok: true, alreadyActive: result.alreadyActive ?? false },
      );
    },
  } as unknown as AgentTool<any>;
}

export function createExitPlanModeTool(_cwd: string, options?: ModeToolOptions): AgentTool<any> {
  return {
    name: 'ExitPlanMode',
    label: 'ExitPlanMode',
    description: 'Leave plan mode and resume normal (writable) execution. Pass a `plan` (markdown) to present it for user approval first - on approval, plan mode clears and you may proceed; on rejection, read the feedback and revise. Without a plan, exits immediately.',
    parameters: {
      type: 'object',
      properties: {
        plan: { type: 'string', description: 'The completed plan in markdown, presented to the user for approval' },
        allowedPrompts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string' },
              prompt: { type: 'string' },
            },
            required: ['tool', 'prompt'],
          },
          description: 'Tool calls the plan intends to make',
        },
      },
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const db = options?.db;
      const sessionId = options?.sessionId;
      if (!db || !sessionId) return errorResult('missing_session_context', 'ExitPlanMode requires session context');
      const repo = new SessionRepository(db);
      const args = params && typeof params === 'object' ? params as Record<string, unknown> : {};
      const plan = typeof args.plan === 'string' ? args.plan.trim() : '';

      if (plan) {
        const interactionId = randomUUID();
        const event: PlanReviewInteractionMessage = {
          type: 'interaction_plan_review',
          interactionId,
          sessionId,
          source: 'tool_call',
          createdAt: Date.now(),
          plan,
          allowedPrompts: args.allowedPrompts as PlanReviewInteractionMessage['allowedPrompts'],
        };
        const response = await interactionDispatcher.dispatchAndWait(interactionId, sessionId, event);
        if (response.error) return errorResult('plan_review_failed', String(response.error));
        if (response.approved !== true) {
          const feedback = typeof response.feedback === 'string' && response.feedback.trim()
            ? response.feedback.trim()
            : 'Plan rejected by the user.';
          return errorResult('plan_rejected', feedback);
        }
        applyExitPlanMode(repo, sessionId);
        return textResult('Plan approved. Plan mode cleared - you may execute the plan now.', { ok: true, approved: true });
      }

      const result = applyExitPlanMode(repo, sessionId);
      return textResult(
        result.wasActive ? 'Exited plan mode - you may make changes now.' : 'Not currently in plan mode.',
        { ok: true, wasActive: result.wasActive ?? false },
      );
    },
  } as unknown as AgentTool<any>;
}
