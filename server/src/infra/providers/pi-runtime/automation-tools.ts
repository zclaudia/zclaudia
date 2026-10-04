/**
 * CronCreate / CronList / CronUpdate / CronDelete — agent-callable automations.
 *
 * Each automation is a project-scoped `ai_prompt` activity bound to a cron,
 * interval or one-shot trigger, run by the automations domain scheduler
 * (domains/automations/service.ts). The tools only ever touch automations of
 * the calling session's project and never system-owned rows.
 */
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';
import type { Automation, AutomationTrigger } from '@zclaudia/shared/features/automations';
import { isValidCron } from '../../../utils/cron.js';
import type { AutomationPort } from '../types.js';
import { agentToolParameters, errorResult, jsonResult, toolParams } from './tool-common.js';

export const AI_PROMPT_ACTIVITY = 'ai_prompt';
const MAX_DELAY_MINUTES = 60 * 24 * 366;
const MAX_INTERVAL_MINUTES = 60 * 24 * 366;

export interface AutomationToolDeps {
  cwd: string;
  sessionId?: string;
  db?: Database.Database;
  port?: AutomationPort;
  /** LLM profile the created automation's prompt step should run with. */
  llmProfileId?: string;
}

function resolveProjectId(db: Database.Database | undefined, sessionId: string | undefined) {
  if (!db || !sessionId) return undefined;
  try {
    const row = db
      .prepare('SELECT project_id AS projectId FROM sessions WHERE id = ?')
      .get(sessionId) as { projectId?: string } | undefined;
    return typeof row?.projectId === 'string' && row.projectId.trim() ? row.projectId : undefined;
  } catch {
    return undefined;
  }
}

type ScheduleParse =
  | { ok: true; trigger: AutomationTrigger; label: string }
  | { ok: false; code: string; message: string };

/** Exactly one of cron / delayMinutes / intervalMinutes must be given. */
export function parseSchedule(args: Record<string, unknown>, now = Date.now()): ScheduleParse {
  const given = ['cron', 'delayMinutes', 'intervalMinutes'].filter(key => args[key] !== undefined);
  if (given.length !== 1) {
    return {
      ok: false,
      code: 'invalid_schedule',
      message: 'Provide exactly one of cron, delayMinutes or intervalMinutes',
    };
  }
  if (args.cron !== undefined) {
    const cron = typeof args.cron === 'string' ? args.cron.trim() : '';
    if (!cron || !isValidCron(cron)) {
      return { ok: false, code: 'invalid_cron', message: `Invalid 5-field cron: "${cron}"` };
    }
    return { ok: true, trigger: { type: 'cron', cron }, label: `cron: ${cron}` };
  }
  if (args.delayMinutes !== undefined) {
    const minutes = Number(args.delayMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_DELAY_MINUTES) {
      return {
        ok: false,
        code: 'invalid_delay',
        message: `delayMinutes must be an integer between 1 and ${MAX_DELAY_MINUTES}`,
      };
    }
    const onceAt = now + minutes * 60_000;
    return { ok: true, trigger: { type: 'once', onceAt }, label: `once in ${minutes} min` };
  }
  const minutes = Number(args.intervalMinutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_INTERVAL_MINUTES) {
    return {
      ok: false,
      code: 'invalid_interval',
      message: `intervalMinutes must be an integer between 1 and ${MAX_INTERVAL_MINUTES}`,
    };
  }
  return {
    ok: true,
    trigger: { type: 'interval', intervalMinutes: minutes },
    label: `every ${minutes} min`,
  };
}

function summarize(automation: Automation) {
  const input = automation.action.input ?? {};
  return {
    id: automation.id,
    title: automation.name,
    description: automation.description,
    enabled: automation.enabled,
    trigger: automation.trigger,
    prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
    createdAt: automation.createdAt,
    updatedAt: automation.updatedAt,
  };
}

function ownedBy(automation: Automation | null, projectId: string): Automation | undefined {
  if (!automation || automation.isSystem) return undefined;
  if (automation.projectId !== projectId) return undefined;
  return automation;
}

const SCHEDULE_PROPERTIES = {
  cron: {
    type: 'string',
    description:
      '5-field cron expression in the server\'s local time zone, e.g. "0 9 * * 1-5". Use for clock-based schedules.',
  },
  delayMinutes: {
    type: 'integer',
    description:
      'Run once, this many minutes from now. Use for "in 30 minutes"-style requests instead of computing a cron.',
  },
  intervalMinutes: {
    type: 'integer',
    description: 'Run repeatedly every N minutes. Use for "every 2 hours"-style requests.',
  },
} as const;

export function createCronCreateTool(deps: AutomationToolDeps): AgentTool {
  const { cwd, sessionId, db, port, llmProfileId } = deps;
  return {
    name: 'CronCreate',
    label: 'CronCreate',
    description:
      "Create a persistent automation for this project that runs an AI prompt on a schedule (it survives restarts and shows up under Automations). Provide exactly one of cron, delayMinutes or intervalMinutes. Keep the user's schedule phrasing in the title. An automation run must never create further automations.",
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name shown in the Automations list' },
        prompt: {
          type: 'string',
          description:
            'Self-contained instructions for the scheduled run. It has no access to this conversation, so include everything it needs.',
        },
        description: { type: 'string' },
        ...SCHEDULE_PROPERTIES,
      },
      required: ['title', 'prompt'],
      additionalProperties: false,
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!port) return errorResult('automations_unavailable', 'Automations are not available');
      const projectId = resolveProjectId(db, sessionId);
      if (!projectId) {
        return errorResult('missing_project', 'CronCreate requires a project-bound session');
      }
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
      if (!title) return errorResult('missing_title', 'CronCreate requires a title');
      if (!prompt) return errorResult('missing_prompt', 'CronCreate requires a prompt');
      const schedule = parseSchedule(args);
      if (!schedule.ok) return errorResult(schedule.code, schedule.message);
      try {
        const automation = port.create({
          projectId,
          name: title,
          description: typeof args.description === 'string' ? args.description.trim() : undefined,
          enabled: true,
          trigger: schedule.trigger,
          action: {
            kind: 'activity',
            ref: AI_PROMPT_ACTIVITY,
            input: {
              prompt,
              workingDirectory: cwd,
              ...(llmProfileId ? { llmProfileId } : {}),
            },
          },
        });
        return jsonResult({
          ok: true,
          automation: summarize(automation),
          schedule: schedule.label,
          ...(llmProfileId
            ? {}
            : { warning: 'No LLM profile bound; the run will use the project default.' }),
        });
      } catch (err) {
        return errorResult(
          'automation_create_failed',
          err instanceof Error ? err.message : String(err)
        );
      }
    },
  };
}

export function createCronListTool(deps: AutomationToolDeps): AgentTool {
  const { sessionId, db, port } = deps;
  return {
    name: 'CronList',
    label: 'CronList',
    description: 'List the automations of this project (id, title, schedule, enabled, prompt).',
    parameters: agentToolParameters({
      type: 'object',
      properties: {},
      additionalProperties: false,
    }),
    execute: async () => {
      if (!port) return errorResult('automations_unavailable', 'Automations are not available');
      const projectId = resolveProjectId(db, sessionId);
      if (!projectId) {
        return errorResult('missing_project', 'CronList requires a project-bound session');
      }
      const automations = port.list(projectId).filter(item => !item.isSystem);
      return jsonResult({
        ok: true,
        count: automations.length,
        automations: automations.map(summarize),
      });
    },
  };
}

export function createCronUpdateTool(deps: AutomationToolDeps): AgentTool {
  const { sessionId, db, port } = deps;
  return {
    name: 'CronUpdate',
    label: 'CronUpdate',
    description:
      'Update an automation of this project in place (title, prompt, schedule, enabled). Only the given fields change; run history is preserved. Do not simulate this with delete + create.',
    parameters: agentToolParameters({
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        prompt: { type: 'string' },
        description: { type: 'string' },
        enabled: { type: 'boolean' },
        ...SCHEDULE_PROPERTIES,
      },
      required: ['id'],
      additionalProperties: false,
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!port) return errorResult('automations_unavailable', 'Automations are not available');
      const projectId = resolveProjectId(db, sessionId);
      if (!projectId) {
        return errorResult('missing_project', 'CronUpdate requires a project-bound session');
      }
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      if (!id) return errorResult('missing_id', 'CronUpdate requires an id');
      const existing = ownedBy(port.get(id), projectId);
      if (!existing) return errorResult('automation_not_found', `Automation not found: ${id}`);

      const patch: Partial<Omit<Automation, 'id' | 'projectId' | 'createdAt'>> = {};
      if (typeof args.title === 'string' && args.title.trim()) patch.name = args.title.trim();
      if (typeof args.description === 'string') patch.description = args.description.trim();
      if (typeof args.enabled === 'boolean') patch.enabled = args.enabled;
      const scheduleGiven = ['cron', 'delayMinutes', 'intervalMinutes'].some(
        key => args[key] !== undefined
      );
      if (scheduleGiven) {
        const schedule = parseSchedule(args);
        if (!schedule.ok) return errorResult(schedule.code, schedule.message);
        patch.trigger = schedule.trigger;
      }
      if (typeof args.prompt === 'string' && args.prompt.trim()) {
        patch.action = {
          ...existing.action,
          input: { ...(existing.action.input ?? {}), prompt: args.prompt.trim() },
        };
      }
      if (Object.keys(patch).length === 0) {
        return errorResult('nothing_to_update', 'CronUpdate requires at least one field to change');
      }
      try {
        const updated = port.update(id, patch);
        return jsonResult({ ok: true, automation: summarize(updated) });
      } catch (err) {
        return errorResult(
          'automation_update_failed',
          err instanceof Error ? err.message : String(err)
        );
      }
    },
  };
}

export function createCronDeleteTool(deps: AutomationToolDeps): AgentTool {
  const { sessionId, db, port } = deps;
  return {
    name: 'CronDelete',
    label: 'CronDelete',
    description: 'Delete an automation of this project by id.',
    parameters: agentToolParameters({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    }),
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      if (!port) return errorResult('automations_unavailable', 'Automations are not available');
      const projectId = resolveProjectId(db, sessionId);
      if (!projectId) {
        return errorResult('missing_project', 'CronDelete requires a project-bound session');
      }
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      if (!id) return errorResult('missing_id', 'CronDelete requires an id');
      const existing = ownedBy(port.get(id), projectId);
      if (!existing) return errorResult('automation_not_found', `Automation not found: ${id}`);
      try {
        port.delete(id);
        return jsonResult({ ok: true, id, title: existing.name });
      } catch (err) {
        return errorResult(
          'automation_delete_failed',
          err instanceof Error ? err.message : String(err)
        );
      }
    },
  };
}
