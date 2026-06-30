/**
 * Automations API — CRUD for the Automation entity (trigger + action).
 */

import { Router, type Request, type Response } from 'express';
import type { AutomationService } from '../../domains/automations/service.js';
import type { AutomationAction, AutomationTrigger } from '@zclaudia/shared/features/automations';

interface AutomationBody {
  name?: string;
  description?: string;
  projectId?: string;
  enabled?: boolean;
  trigger?: AutomationTrigger;
  action?: AutomationAction;
}

function validate(body: AutomationBody): string | null {
  if (!body.name?.trim()) return 'name is required';
  if (!body.trigger?.type) return 'trigger.type is required';
  if (!body.action?.kind) return 'action.kind is required';
  if (body.action.kind !== 'activity' && body.action.kind !== 'workflow') return "action.kind must be 'activity' or 'workflow'";
  if (!body.action.ref?.trim()) return 'action.ref is required';
  const t = body.trigger;
  if (t.type === 'cron' && !t.cron?.trim()) return 'trigger.cron is required for cron triggers';
  if (t.type === 'interval' && (!t.intervalMinutes || t.intervalMinutes < 1)) return 'trigger.intervalMinutes must be >= 1';
  if (t.type === 'once' && typeof t.onceAt !== 'number') return 'trigger.onceAt is required for one-time triggers';
  if (t.type === 'event' && !t.event?.trim()) return 'trigger.event is required for event triggers';
  return null;
}

function fail(res: Response, code: number, message: string, errCode = 'VALIDATION_ERROR') {
  res.status(code).json({ success: false, error: { code: errCode, message } });
}

export function createAutomationRoutes(automationService: AutomationService): Router {
  const router = Router();

  router.post('/', (req: Request, res: Response) => {
    try {
      const body = req.body as AutomationBody;
      const err = validate(body);
      if (err) return fail(res, 400, err);
      const automation = automationService.createAutomation({
        projectId: body.projectId,
        name: body.name!.trim(),
        description: body.description,
        enabled: body.enabled ?? true,
        trigger: body.trigger!,
        action: body.action!,
      });
      res.status(201).json({ success: true, data: automation });
    } catch (error) {
      fail(res, 500, error instanceof Error ? error.message : String(error), 'INTERNAL_ERROR');
    }
  });

  router.get('/', (req: Request, res: Response) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      res.json({ success: true, data: automationService.listAutomations(projectId) });
    } catch (error) {
      fail(res, 500, error instanceof Error ? error.message : String(error), 'INTERNAL_ERROR');
    }
  });

  router.patch('/:id', (req: Request, res: Response) => {
    try {
      const automation = automationService.updateAutomation(req.params.id, req.body);
      res.json({ success: true, data: automation });
    } catch (error) {
      fail(res, 500, error instanceof Error ? error.message : String(error), 'INTERNAL_ERROR');
    }
  });

  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const ok = automationService.deleteAutomation(req.params.id);
      res.json({ success: ok });
    } catch (error) {
      fail(res, 500, error instanceof Error ? error.message : String(error), 'INTERNAL_ERROR');
    }
  });

  router.post('/:id/trigger', async (req: Request, res: Response) => {
    try {
      const run = await automationService.runAction(req.params.id, { initiator: 'manual', triggerSource: 'manual' });
      res.json({ success: true, data: run });
    } catch (error) {
      fail(res, 500, error instanceof Error ? error.message : String(error), 'INTERNAL_ERROR');
    }
  });

  router.get('/:id/runs', (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: automationService.getRunsForAutomation(req.params.id) });
    } catch (error) {
      fail(res, 500, error instanceof Error ? error.message : String(error), 'INTERNAL_ERROR');
    }
  });

  return router;
}
