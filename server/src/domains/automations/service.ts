/**
 * Automation Service — owns triggers (scheduling + events) and binds them to actions.
 *
 * An action is either an inline Activity (single step, run as an ephemeral one-node
 * workflow) or a persisted Workflow. Running an action goes through the workflow engine
 * and produces a Run; direct synchronous Activity invocations (panel routes) do NOT.
 */

import type { Database } from 'better-sqlite3';
import type {
  Automation,
  AutomationAction,
  AutomationTrigger,
} from '@zclaudia/shared/features/automations';
import type {
  Workflow,
  WorkflowDefinition,
  WorkflowRun,
} from '@zclaudia/shared/features/workflows';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import { AutomationRepository } from './repository.js';
import { WorkflowRunRepository } from '../workflows/workflow-run-repository.js';
import { newId } from '../../utils/uuid.js';
import { computeNextCronRun } from '../../utils/cron.js';
import { pluginEvents } from '../../infra/events/index.js';
import { SYSTEM_PERMISSION_AUTOMATION_KEY } from './templates.js';

/** Minimal slice of WorkflowEngine the automation service needs. */
export interface AutomationEnginePort {
  startRun(opts: {
    workflowId?: string;
    projectId: string | undefined;
    definition: WorkflowDefinition;
    triggerSource: 'manual' | 'schedule' | 'event';
    initiator: string;
    actionKind?: 'activity' | 'workflow';
    actionRef?: string;
    triggerDetail?: string;
    triggerData?: {
      eventPayload?: Record<string, unknown>;
      triggerContext?: Record<string, unknown>;
    };
    trackingKey?: string;
  }): Promise<WorkflowRun>;
  isRunningKey(key: string): boolean;
}

/** Minimal slice of WorkflowService for resolving workflow-action definitions. */
export interface AutomationWorkflowLookupPort {
  getWorkflow(workflowId: string): Workflow | null;
}

export class ImmutableSystemAutomationError extends Error {
  constructor(message = 'System automation is immutable') {
    super(message);
    this.name = 'ImmutableSystemAutomationError';
  }
}

export class AutomationService {
  private repo: AutomationRepository;
  private runRepo: WorkflowRunRepository;
  private eventSubscriptions: Array<() => void> = [];
  /** automationId -> next scheduled run (epoch ms) for cron/interval/once triggers. */
  private nextRunByAutomation = new Map<string, number>();

  constructor(
    private db: Database,
    private broadcastFn: (
      projectId: string | undefined,
      message: ServerMessage | { type: string; [key: string]: unknown }
    ) => void,
    private engine: AutomationEnginePort,
    private workflows: AutomationWorkflowLookupPort
  ) {
    this.repo = new AutomationRepository(db);
    this.runRepo = new WorkflowRunRepository(db);
  }

  // ── CRUD ──────────────────────────────────────────────────────
  listAutomations(projectId?: string): Automation[] {
    return projectId ? this.repo.findByProject(projectId) : this.repo.findAll();
  }

  getAutomation(id: string): Automation | null {
    return this.repo.findById(id);
  }

  getRunsForAutomation(automationId: string, limit = 50) {
    return this.runRepo.findByInitiator(`automation:${automationId}`, limit);
  }

  /**
   * Ensure the system permission automation exists, bound to the trigger-free system
   * permission workflow. The event subscription is inert (escalation is driven
   * imperatively by PermissionWorkflowResolver); this row exists for model completeness.
   */
  ensureSystemAutomations(systemWorkflowId: string): void {
    const existing = this.repo.findBySystemKey(SYSTEM_PERMISSION_AUTOMATION_KEY);
    const desiredAction = { kind: 'workflow' as const, ref: systemWorkflowId };
    const desiredTrigger = { type: 'event' as const, event: 'permission.escalated' };
    if (!existing) {
      this.repo.create({
        name: 'Permission Escalation (System)',
        description: 'Routes escalated permission requests to the system permission workflow.',
        enabled: true,
        trigger: desiredTrigger,
        action: desiredAction,
        isSystem: true,
        systemKey: SYSTEM_PERMISSION_AUTOMATION_KEY,
      });
      return;
    }
    if (
      existing.action.ref !== systemWorkflowId ||
      JSON.stringify(existing.trigger) !== JSON.stringify(desiredTrigger)
    ) {
      this.repo.update(existing.id, { trigger: desiredTrigger, action: desiredAction });
    }
  }

  createAutomation(data: {
    projectId?: string;
    name: string;
    description?: string;
    enabled?: boolean;
    trigger: AutomationTrigger;
    action: AutomationAction;
    isSystem?: boolean;
    systemKey?: string;
  }): Automation {
    const automation = this.repo.create({
      projectId: data.projectId,
      name: data.name,
      description: data.description,
      enabled: data.enabled ?? true,
      trigger: data.trigger,
      action: data.action,
      isSystem: data.isSystem,
      systemKey: data.systemKey,
    });
    this.syncSchedule(automation);
    this.rebuildEventSubscriptions();
    this.broadcast(automation);
    return automation;
  }

  updateAutomation(
    id: string,
    data: Partial<Omit<Automation, 'id' | 'projectId' | 'createdAt'>>
  ): Automation {
    const existing = this.repo.findById(id);
    if (existing?.isSystem) throw new ImmutableSystemAutomationError();
    const automation = this.repo.update(id, data);
    this.syncSchedule(automation);
    this.rebuildEventSubscriptions();
    this.broadcast(automation);
    return automation;
  }

  deleteAutomation(id: string): boolean {
    const existing = this.repo.findById(id);
    if (existing?.isSystem) throw new ImmutableSystemAutomationError();
    const deleted = this.repo.delete(id);
    if (deleted) {
      this.nextRunByAutomation.delete(id);
      this.rebuildEventSubscriptions();
      this.broadcastFn(existing?.projectId, {
        type: 'automation_deleted',
        automationId: id,
        projectId: existing?.projectId,
      });
    }
    return deleted;
  }

  // ── Action execution (engine bridge) ──────────────────────────
  async runAction(
    automationId: string,
    ctx: {
      initiator: string;
      triggerSource: 'manual' | 'schedule' | 'event';
      triggerDetail?: string;
      eventPayload?: Record<string, unknown>;
      triggerContext?: Record<string, unknown>;
    }
  ): Promise<WorkflowRun> {
    const automation = this.repo.findById(automationId);
    if (!automation) throw new Error(`Automation not found: ${automationId}`);
    return this.runActionFor(automation, ctx);
  }

  /** Run an action object directly (used by system/permission paths that already hold the automation). */
  async runActionFor(
    automation: Automation,
    ctx: {
      initiator: string;
      triggerSource: 'manual' | 'schedule' | 'event';
      triggerDetail?: string;
      eventPayload?: Record<string, unknown>;
      triggerContext?: Record<string, unknown>;
    }
  ): Promise<WorkflowRun> {
    const { action } = automation;

    if (action.kind === 'workflow') {
      const wf = this.workflows.getWorkflow(action.ref);
      if (!wf) throw new Error(`Workflow not found: ${action.ref}`);
      return this.engine.startRun({
        workflowId: wf.id,
        projectId: automation.projectId ?? wf.projectId,
        definition: wf.definition,
        triggerSource: ctx.triggerSource,
        initiator: ctx.initiator,
        actionKind: 'workflow',
        actionRef: wf.id,
        triggerDetail: ctx.triggerDetail,
        triggerData: { eventPayload: ctx.eventPayload, triggerContext: ctx.triggerContext },
        trackingKey: wf.id,
      });
    }

    // kind === 'activity' → ephemeral one-node workflow
    const node = {
      id: newId().slice(0, 8),
      name: automation.name,
      type: action.ref,
      config: action.input ?? {},
      position: { x: 0, y: 0 },
    };
    const definition: WorkflowDefinition = { nodes: [node], edges: [], entryNodeId: node.id };
    return this.engine.startRun({
      workflowId: undefined,
      projectId: automation.projectId,
      definition,
      triggerSource: ctx.triggerSource,
      initiator: ctx.initiator,
      actionKind: 'activity',
      actionRef: action.ref,
      triggerDetail: ctx.triggerDetail,
      triggerData: { eventPayload: ctx.eventPayload, triggerContext: ctx.triggerContext },
      trackingKey: `automation:${automation.id}`,
    });
  }

  // ── Schedule + events ─────────────────────────────────────────
  initialize(): void {
    for (const a of this.repo.findAllEnabled()) this.syncSchedule(a);
    this.rebuildEventSubscriptions();
  }

  async tick(): Promise<void> {
    try {
      const now = Date.now();
      for (const automation of this.repo.findAllEnabled()) {
        const nextRun = this.nextRunByAutomation.get(automation.id);
        if (nextRun == null || nextRun > now) continue;
        const trackingKey =
          automation.action.kind === 'workflow'
            ? automation.action.ref
            : `automation:${automation.id}`;
        if (this.engine.isRunningKey(trackingKey)) continue;

        const t = automation.trigger;
        const triggerDetail =
          t.type === 'cron'
            ? `cron: ${t.cron}`
            : t.type === 'once'
              ? `once: ${new Date(t.onceAt || 0).toISOString()}`
              : `interval: ${t.intervalMinutes}min`;

        try {
          await this.runActionFor(automation, {
            initiator: `automation:${automation.id}`,
            triggerSource: 'schedule',
            triggerDetail,
            triggerContext: {
              type: t.type,
              cron: t.cron,
              intervalMinutes: t.intervalMinutes,
              onceAt: t.onceAt,
            },
          });
        } catch (err) {
          console.error(`[Automation] Schedule trigger failed for ${automation.id}:`, err);
        }

        const next = this.computeNextRun(t);
        if (next == null) this.nextRunByAutomation.delete(automation.id);
        else this.nextRunByAutomation.set(automation.id, next);
      }
    } catch (err) {
      console.error('[Automation] tick error:', err);
    }
  }

  private syncSchedule(automation: Automation): void {
    if (!automation.enabled) {
      this.nextRunByAutomation.delete(automation.id);
      return;
    }
    const t = automation.trigger;
    if (t.type !== 'cron' && t.type !== 'interval' && t.type !== 'once') {
      this.nextRunByAutomation.delete(automation.id);
      return;
    }
    const next = this.computeNextRun(t);
    if (next == null) this.nextRunByAutomation.delete(automation.id);
    else this.nextRunByAutomation.set(automation.id, next);
  }

  private computeNextRun(t: AutomationTrigger): number | null {
    if (t.type === 'cron' && t.cron) return computeNextCronRun(t.cron);
    if (t.type === 'interval' && t.intervalMinutes)
      return Date.now() + t.intervalMinutes * 60 * 1000;
    if (t.type === 'once' && t.onceAt) return t.onceAt > Date.now() ? t.onceAt : null;
    return null;
  }

  private rebuildEventSubscriptions(): void {
    for (const unsub of this.eventSubscriptions) unsub();
    this.eventSubscriptions = [];

    const byEvent = new Map<string, Automation[]>();
    for (const a of this.repo.findAllEnabled()) {
      if (a.trigger.type === 'event' && a.trigger.event) {
        // System permission automation is driven imperatively via the resolver; do not
        // subscribe it to the bus (nothing emits permission.escalated anyway).
        if (a.isSystem) continue;
        const list = byEvent.get(a.trigger.event) ?? [];
        list.push(a);
        byEvent.set(a.trigger.event, list);
      }
    }

    for (const [event, automations] of byEvent) {
      const isPattern = event.includes('*');
      const handler = async (data: unknown) => {
        for (const a of automations) {
          const fresh = this.repo.findById(a.id);
          if (!fresh || !fresh.enabled) continue;
          if (fresh.trigger.eventFilter && !this.matchesFilter(data, fresh.trigger.eventFilter))
            continue;
          try {
            await this.runActionFor(fresh, {
              initiator: `automation:${fresh.id}`,
              triggerSource: 'event',
              triggerDetail: `event: ${event}`,
              eventPayload:
                data && typeof data === 'object'
                  ? (data as Record<string, unknown>)
                  : { value: data },
              triggerContext: { type: 'event', event },
            });
          } catch (err) {
            console.error(`[Automation] Event trigger failed for ${fresh.id}:`, err);
          }
        }
      };
      const unsub = isPattern
        ? pluginEvents.onPattern(event, handler, 'automation-engine')
        : pluginEvents.on(event, handler, 'automation-engine');
      this.eventSubscriptions.push(unsub);
    }
  }

  private matchesFilter(data: unknown, filter: Record<string, unknown>): boolean {
    if (!data || typeof data !== 'object') return false;
    const record = data as Record<string, unknown>;
    for (const [key, value] of Object.entries(filter)) {
      if (record[key] !== value) return false;
    }
    return true;
  }

  private broadcast(automation: Automation): void {
    this.broadcastFn(automation.projectId, {
      type: 'automation_update',
      projectId: automation.projectId,
      automation,
    });
  }
}
