/**
 * Workflow Service (Facade)
 *
 * Provides CRUD operations, system-workflow management, run queries, and
 * manual/triggered runs. Scheduling + event subscriptions are owned by
 * AutomationService.
 */

import type { Database } from 'better-sqlite3';
import type {
  Workflow,
  WorkflowRun,
  WorkflowStepRun,
  WorkflowDefinition,
} from '@zclaudia/shared/features/workflows';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import { WorkflowRepository } from './repository.js';
import { WorkflowRunRepository } from './workflow-run-repository.js';
import { WorkflowStepRunRepository } from './workflow-step-run-repository.js';
import type { WorkflowEngine } from './engine.js';
import {
  BUILTIN_WORKFLOW_TEMPLATES,
  PERMISSION_WORKFLOW_TEMPLATE_ID,
  SYSTEM_PERMISSION_ESCALATION_FALLBACK_KEY,
  AI_AUTO_COMMIT_TEMPLATE_ID,
  SYSTEM_AI_AUTO_COMMIT_KEY,
} from './templates.js';

export class ImmutableSystemWorkflowError extends Error {
  constructor(message = 'System workflow is immutable') {
    super(message);
    this.name = 'ImmutableSystemWorkflowError';
  }
}

export class WorkflowService {
  private workflowRepo: WorkflowRepository;
  private runRepo: WorkflowRunRepository;
  private stepRunRepo: WorkflowStepRunRepository;

  constructor(
    private db: Database,
    private broadcastFn: (projectId: string | undefined, message: ServerMessage | { type: string; projectId?: string; [key: string]: unknown }) => void,
    private engine: WorkflowEngine,
  ) {
    this.workflowRepo = new WorkflowRepository(db);
    this.runRepo = new WorkflowRunRepository(db);
    this.stepRunRepo = new WorkflowStepRunRepository(db);
  }

  // ── Initialization ────────────────────────────────────────────

  initialize(): void {
    this.ensureBuiltinWorkflows();
    this.ensureBuiltinAutoCommitWorkflow();
  }

  private ensureBuiltinWorkflows(): void {
    const template = BUILTIN_WORKFLOW_TEMPLATES.find(t => t.id === PERMISSION_WORKFLOW_TEMPLATE_ID);
    if (!template) return;

    const systemWorkflow = this.workflowRepo.findBySystemKey(SYSTEM_PERMISSION_ESCALATION_FALLBACK_KEY);
    if (!systemWorkflow) {
      const legacyGlobal = this.workflowRepo.findGlobalByTemplate(PERMISSION_WORKFLOW_TEMPLATE_ID);
      if (legacyGlobal) {
        this.workflowRepo.update(legacyGlobal.id, {
          status: 'active',
          definition: template.definition,
          isSystem: true,
          systemKey: SYSTEM_PERMISSION_ESCALATION_FALLBACK_KEY,
          sourceType: 'template',
        });
        console.log(`[Workflow] Adopted global builtin workflow as system fallback: ${template.name}`);
        return;
      }

      this.workflowRepo.create({
        projectId: undefined,
        name: template.name,
        description: template.description,
        status: 'active',
        definition: template.definition,
        templateId: template.id,
        isSystem: true,
        systemKey: SYSTEM_PERMISSION_ESCALATION_FALLBACK_KEY,
        sourceType: 'template',
      });
      console.log(`[Workflow] Auto-created system fallback workflow: ${template.name}`);
      return;
    }

    const needsRepair = systemWorkflow.status !== 'active'
      || systemWorkflow.templateId !== PERMISSION_WORKFLOW_TEMPLATE_ID
      || !systemWorkflow.isSystem
      || JSON.stringify(systemWorkflow.definition) !== JSON.stringify(template.definition);

    if (needsRepair) {
      this.workflowRepo.update(systemWorkflow.id, {
        name: template.name,
        description: template.description,
        status: 'active',
        definition: template.definition,
        templateId: template.id,
        isSystem: true,
        systemKey: SYSTEM_PERMISSION_ESCALATION_FALLBACK_KEY,
        sourceType: 'template',
      });
      console.log(`[Workflow] Repaired system fallback workflow: ${template.name}`);
    }
  }

  private ensureBuiltinAutoCommitWorkflow(): void {
    const template = BUILTIN_WORKFLOW_TEMPLATES.find(t => t.id === AI_AUTO_COMMIT_TEMPLATE_ID);
    if (!template) return;

    const existing = this.workflowRepo.findBySystemKey(SYSTEM_AI_AUTO_COMMIT_KEY);
    if (!existing) {
      this.workflowRepo.create({
        projectId: undefined,
        name: template.name,
        description: template.description,
        status: 'active',
        definition: template.definition,
        templateId: template.id,
        isSystem: true,
        systemKey: SYSTEM_AI_AUTO_COMMIT_KEY,
        sourceType: 'template',
      });
      console.log(`[Workflow] Auto-created system workflow: ${template.name}`);
      return;
    }

    const needsRepair = existing.status !== 'active'
      || existing.templateId !== AI_AUTO_COMMIT_TEMPLATE_ID
      || !existing.isSystem
      || JSON.stringify(existing.definition) !== JSON.stringify(template.definition);

    if (needsRepair) {
      this.workflowRepo.update(existing.id, {
        name: template.name,
        description: template.description,
        status: 'active',
        definition: template.definition,
        templateId: template.id,
        isSystem: true,
        systemKey: SYSTEM_AI_AUTO_COMMIT_KEY,
        sourceType: 'template',
      });
      console.log(`[Workflow] Repaired system workflow: ${template.name}`);
    }
  }

  getSystemPermissionFallback(): Workflow {
    const workflow = this.workflowRepo.findBySystemKey(SYSTEM_PERMISSION_ESCALATION_FALLBACK_KEY);
    if (!workflow) {
      throw new Error('System permission fallback workflow is missing');
    }
    return workflow;
  }

  // ── Workflow CRUD ─────────────────────────────────────────────

  listWorkflows(projectId: string): Workflow[] {
    return this.workflowRepo.findByProject(projectId);
  }

  listAllWorkflows(): Workflow[] {
    return this.workflowRepo.findAll();
  }

  getWorkflow(workflowId: string): Workflow | null {
    return this.workflowRepo.findById(workflowId);
  }

  createWorkflow(data: {
    projectId?: string;
    name: string;
    description?: string;
    definition: WorkflowDefinition;
    templateId?: string;
    status?: 'active' | 'disabled';
    sourcePluginId?: string;
    sourceType?: 'user' | 'plugin' | 'template';
    authoringMode?: 'graph' | 'event-trigger';
  }): Workflow {
    const workflow = this.workflowRepo.create({
      projectId: data.projectId,
      name: data.name,
      description: data.description,
      status: data.status ?? 'active',
      definition: data.definition,
      templateId: data.templateId,
      sourcePluginId: data.sourcePluginId,
      sourceType: data.sourceType,
      authoringMode: data.authoringMode,
    });

    this.broadcastWorkflowUpdate(workflow);
    return workflow;
  }

  updateWorkflow(workflowId: string, data: Partial<Omit<Workflow, 'id' | 'projectId' | 'createdAt'>>): Workflow {
    const existing = this.workflowRepo.findById(workflowId);
    if (existing?.isSystem) {
      throw new ImmutableSystemWorkflowError();
    }
    const workflow = this.workflowRepo.update(workflowId, data);

    this.broadcastWorkflowUpdate(workflow);
    return workflow;
  }

  deleteWorkflow(workflowId: string, projectId?: string): boolean {
    const existing = this.workflowRepo.findById(workflowId);
    if (existing?.isSystem) {
      throw new ImmutableSystemWorkflowError();
    }
    const deleted = this.workflowRepo.delete(workflowId);
    if (deleted) {
      this.broadcastFn(projectId, {
        type: 'workflow_deleted',
        projectId,
        workflowId,
      });
    }
    return deleted;
  }

  // ── Template Operations ───────────────────────────────────────

  getTemplates() {
    return BUILTIN_WORKFLOW_TEMPLATES;
  }

  createFromTemplate(projectId: string | undefined, templateId: string): Workflow {
    if (templateId === PERMISSION_WORKFLOW_TEMPLATE_ID) {
      throw new ImmutableSystemWorkflowError('Permission escalation template is managed by the system');
    }
    const template = BUILTIN_WORKFLOW_TEMPLATES.find(t => t.id === templateId);
    if (!template) throw new Error(`Template not found: ${templateId}`);

    // Check if already exists — toggle enable/disable
    const existing = projectId
      ? this.workflowRepo.findByProjectAndTemplate(projectId, templateId)
      : this.workflowRepo.findGlobalByTemplate(templateId);
    if (existing) {
      const newStatus = existing.status === 'active' ? 'disabled' : 'active';
      return this.updateWorkflow(existing.id, { status: newStatus });
    }

    return this.createWorkflow({
      projectId,
      name: template.name,
      description: template.description,
      definition: template.definition,
      templateId: template.id,
    });
  }

  // ── Trigger & Run ─────────────────────────────────────────────

  async triggerWorkflow(
    workflowId: string,
    triggerSource: 'manual' | 'schedule' | 'event' = 'manual',
    triggerDetail?: string,
    triggerData?: { eventPayload?: Record<string, unknown>; triggerContext?: Record<string, unknown> },
    initiator?: string,
  ): Promise<WorkflowRun> {
    const workflow = this.workflowRepo.findById(workflowId);
    if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);
    if (workflow.status !== 'active') throw new Error(`Workflow is not active: ${workflowId}`);

    return this.engine.startRun({
      workflowId,
      projectId: workflow.projectId,
      definition: workflow.definition,
      triggerSource,
      initiator: initiator ?? (triggerSource === 'event' ? 'event' : 'manual'),
      actionKind: 'workflow',
      actionRef: workflowId,
      triggerDetail,
      triggerData,
      trackingKey: workflowId,
    });
  }

  getRuns(workflowId: string, limit?: number): WorkflowRun[] {
    return this.runRepo.findByWorkflow(workflowId, limit);
  }

  getRunsByProject(projectId: string, limit?: number): WorkflowRun[] {
    return this.runRepo.findByProject(projectId, limit);
  }

  getRun(runId: string): { run: WorkflowRun; stepRuns: WorkflowStepRun[] } | null {
    const run = this.runRepo.findById(runId);
    if (!run) return null;
    const stepRuns = this.stepRunRepo.findByRun(runId);
    return { run, stepRuns };
  }

  cancelRun(runId: string): boolean {
    return this.engine.cancelRun(runId);
  }

  // ── Approval API ──────────────────────────────────────────────

  approveStep(stepRunId: string): boolean {
    return this.engine.approveStep(stepRunId);
  }

  rejectStep(stepRunId: string): boolean {
    return this.engine.rejectStep(stepRunId);
  }

  // ── Broadcast ─────────────────────────────────────────────────

  private broadcastWorkflowUpdate(workflow: Workflow): void {
    this.broadcastFn(workflow.projectId, {
      type: 'workflow_update',
      projectId: workflow.projectId,
      workflow,
    });
  }
}
