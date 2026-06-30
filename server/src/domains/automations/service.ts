/**
 * Automation Service — owns triggers (scheduling + events) and binds them to actions.
 *
 * An action is either an inline Activity (single step, run as an ephemeral one-node
 * workflow) or a persisted Workflow. Running an action goes through the workflow engine
 * and produces a Run; direct synchronous Activity invocations (panel routes) do NOT.
 */

import type { Database } from 'better-sqlite3';
import type { Automation, AutomationAction, AutomationTrigger } from '@zclaudia/shared/features/automations';
import type { Workflow, WorkflowDefinition, WorkflowRun } from '@zclaudia/shared/features/workflows';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import { AutomationRepository } from './repository.js';
import { newId } from '../../utils/uuid.js';

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
    triggerData?: { eventPayload?: Record<string, unknown>; triggerContext?: Record<string, unknown> };
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
  private eventSubscriptions: Array<() => void> = [];
  /** automationId -> next scheduled run (epoch ms) for cron/interval/once triggers. */
  private nextRunByAutomation = new Map<string, number>();

  constructor(
    private db: Database,
    private broadcastFn: (projectId: string | undefined, message: ServerMessage | { type: string; [key: string]: unknown }) => void,
    private engine: AutomationEnginePort,
    private workflows: AutomationWorkflowLookupPort,
  ) {
    this.repo = new AutomationRepository(db);
  }

  // ── CRUD ──────────────────────────────────────────────────────
  listAutomations(projectId?: string): Automation[] {
    return projectId ? this.repo.findByProject(projectId) : this.repo.findAll();
  }

  getAutomation(id: string): Automation | null {
    return this.repo.findById(id);
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

  updateAutomation(id: string, data: Partial<Omit<Automation, 'id' | 'projectId' | 'createdAt'>>): Automation {
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
      this.broadcastFn(existing?.projectId, { type: 'automation_deleted', automationId: id, projectId: existing?.projectId });
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
    },
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
    },
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

  // ── Schedule + events (filled in Task 10) ─────────────────────
  private syncSchedule(_automation: Automation): void { /* Task 10 */ }
  private rebuildEventSubscriptions(): void { /* Task 10 */ }

  private broadcast(automation: Automation): void {
    this.broadcastFn(automation.projectId, { type: 'automation_update', projectId: automation.projectId, automation });
  }
}
