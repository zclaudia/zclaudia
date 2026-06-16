import type { AgentTool } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

import type { PlanReviewInteractionMessage } from '@zclaudia/shared/interaction/forms';
import { interactionDispatcher } from '../../../application/conversation/interactions/interaction-dispatcher.js';
import { enterPlanMode as applyEnterPlanMode, exitPlanMode as applyExitPlanMode } from '../../../domains/sessions/plan-mode-toggle.js';
import { SessionRepository } from '../../../domains/sessions/repository.js';
import { errorResult, textResult } from './tool-common.js';

const MAX_PLAN_BYTES = 128 * 1024;
const MAX_ALLOWED_PROMPTS = 50;
const MAX_ALLOWED_PROMPT_TOOL_CHARS = 120;
const MAX_ALLOWED_PROMPT_PROMPT_CHARS = 2_000;

export interface ModeToolOptions {
  db?: Database.Database;
  sessionId?: string;
}

function validatePlan(plan: string): { ok: true } | { ok: false; result: ReturnType<typeof errorResult> } {
  const size = Buffer.byteLength(plan, 'utf8');
  if (size <= MAX_PLAN_BYTES) return { ok: true };
  return {
    ok: false,
    result: errorResult('plan_too_large', `Plan is too large (${size} bytes; max ${MAX_PLAN_BYTES}).`, {
      size,
      maxBytes: MAX_PLAN_BYTES,
    }),
  };
}

function parseAllowedPrompts(value: unknown): { ok: true; value?: PlanReviewInteractionMessage['allowedPrompts'] } | { ok: false; result: ReturnType<typeof errorResult> } {
  if (value === undefined) return { ok: true };
  if (!Array.isArray(value)) {
    return { ok: false, result: errorResult('invalid_allowed_prompts', 'allowedPrompts must be an array') };
  }
  if (value.length > MAX_ALLOWED_PROMPTS) {
    return {
      ok: false,
      result: errorResult('invalid_allowed_prompts', `allowedPrompts must contain at most ${MAX_ALLOWED_PROMPTS} entries`, {
        count: value.length,
        max: MAX_ALLOWED_PROMPTS,
      }),
    };
  }

  const parsed: NonNullable<PlanReviewInteractionMessage['allowedPrompts']> = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object') {
      return { ok: false, result: errorResult('invalid_allowed_prompts', 'Each allowedPrompts entry must be an object', { index }) };
    }
    const candidate = item as Record<string, unknown>;
    const tool = typeof candidate.tool === 'string' ? candidate.tool.trim() : '';
    const prompt = typeof candidate.prompt === 'string' ? candidate.prompt.trim() : '';
    if (!tool || !prompt) {
      return { ok: false, result: errorResult('invalid_allowed_prompts', 'Each allowedPrompts entry requires non-empty tool and prompt strings', { index }) };
    }
    if (tool.length > MAX_ALLOWED_PROMPT_TOOL_CHARS || prompt.length > MAX_ALLOWED_PROMPT_PROMPT_CHARS) {
      return {
        ok: false,
        result: errorResult('invalid_allowed_prompts', 'allowedPrompts entry is too large', {
          index,
          maxToolChars: MAX_ALLOWED_PROMPT_TOOL_CHARS,
          maxPromptChars: MAX_ALLOWED_PROMPT_PROMPT_CHARS,
        }),
      };
    }
    parsed.push({ tool, prompt });
  }
  return { ok: true, value: parsed };
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
        const planGuard = validatePlan(plan);
        if (!planGuard.ok) return planGuard.result;
        const allowedPrompts = parseAllowedPrompts(args.allowedPrompts);
        if (!allowedPrompts.ok) return allowedPrompts.result;
        const interactionId = randomUUID();
        const event: PlanReviewInteractionMessage = {
          type: 'interaction_plan_review',
          interactionId,
          sessionId,
          source: 'tool_call',
          createdAt: Date.now(),
          plan,
          ...(allowedPrompts.value !== undefined ? { allowedPrompts: allowedPrompts.value } : {}),
        };
        const response = await interactionDispatcher.dispatchAndWait(interactionId, sessionId, event);
        if (response.error) return errorResult('plan_review_failed', String(response.error));
        if (response.approved !== true) {
          const feedback = typeof response.feedback === 'string' && response.feedback.trim()
            ? response.feedback.trim()
            : 'Plan rejected by the user.';
          return errorResult('plan_rejected', feedback);
        }
        const exitResult = applyExitPlanMode(repo, sessionId);
        if (!exitResult.ok) {
          return errorResult(exitResult.error ?? 'exit_plan_failed', `Could not exit plan mode (${exitResult.error}).`, { approved: true });
        }
        if (!exitResult.wasActive) {
          return textResult('Plan approved, but plan mode was already inactive.', { ok: true, approved: true, wasActive: false });
        }
        return textResult('Plan approved. Plan mode cleared - you may execute the plan now.', { ok: true, approved: true, wasActive: true });
      }

      const result = applyExitPlanMode(repo, sessionId);
      return textResult(
        result.wasActive ? 'Exited plan mode - you may make changes now.' : 'Not currently in plan mode.',
        { ok: true, wasActive: result.wasActive ?? false },
      );
    },
  } as unknown as AgentTool<any>;
}
