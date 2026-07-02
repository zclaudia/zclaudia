/**
 * Automations domain registration.
 *
 * Wires the AutomationService, mounts the /api/automations routes, and starts the
 * scheduler tick (every 10s) — mirroring the workflow scheduler in workflows/register.ts.
 */

import type { Express, RequestHandler } from 'express';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { initDatabase } from '../../infra/storage/db.js';
import type { WorkflowSchedulingPort } from '../workflows/ports/runtime.js';
import {
  AutomationService,
  type AutomationEnginePort,
  type AutomationWorkflowLookupPort,
} from './service.js';
import { createAutomationRoutes } from '../../interfaces/http/automations.js';

export interface AutomationsDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  broadcast: (
    projectId: string | undefined,
    msg: ServerMessage | { type: string; [key: string]: unknown }
  ) => void;
  engine: AutomationEnginePort;
  workflows: AutomationWorkflowLookupPort;
  systemTaskRegistry: WorkflowSchedulingPort;
}

export interface AutomationsDomainResult {
  automationService: AutomationService;
}

export function registerAutomationsDomain(deps: AutomationsDomainDeps): AutomationsDomainResult {
  const { db, app, authMiddleware, broadcast, engine, workflows, systemTaskRegistry } = deps;

  const automationService = new AutomationService(db, broadcast, engine, workflows);
  automationService.initialize();

  app.use('/api/automations', authMiddleware, createAutomationRoutes(automationService));

  systemTaskRegistry.register({
    id: 'system:automation_scheduler',
    name: 'Automation Scheduler',
    description: 'Checks for due automation schedules and starts runs',
    category: 'scheduling',
    intervalMs: 10000,
  });
  setInterval(async () => {
    systemTaskRegistry.markRunStart('system:automation_scheduler');
    const start = Date.now();
    try {
      await automationService.tick();
      systemTaskRegistry.markRunComplete('system:automation_scheduler', Date.now() - start);
    } catch (err) {
      systemTaskRegistry.markRunComplete(
        'system:automation_scheduler',
        Date.now() - start,
        String(err)
      );
      console.error('[Automation] Tick error:', err);
    }
  }, 10000);

  return { automationService };
}
