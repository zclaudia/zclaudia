import type { Workflow, WorkflowRun } from '@zclaudia/shared/features/workflows';
import type { WorkflowService } from './service.js';
import { WorkflowRepository } from './repository.js';
import type { Database } from 'better-sqlite3';

export interface ResolvedPermissionWorkflow {
  workflowId: string;
  source: 'project_override' | 'global_override' | 'system_fallback';
  fallbackReason?: string;
  workflow: Workflow;
}

export class PermissionWorkflowResolver {
  private workflowRepo: WorkflowRepository;

  constructor(
    private db: Database,
    private workflowService: WorkflowService
  ) {
    this.workflowRepo = new WorkflowRepository(db);
  }

  private isUsableOverride(workflow: Workflow | null | undefined): workflow is Workflow {
    return !!workflow && workflow.status === 'active' && !workflow.isSystem;
  }

  resolve(projectId?: string): ResolvedPermissionWorkflow {
    if (projectId) {
      // Same query + row mapping as ProjectRepository.findById (SELECT *
      // tolerates older fixtures without the column); done inline so this
      // resolver does not depend on the projects domain.
      const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as
        | { permission_workflow_override_id?: string | null }
        | undefined;
      const projectOverrideId = row?.permission_workflow_override_id || undefined;
      if (projectOverrideId) {
        const workflow = this.workflowRepo.findById(projectOverrideId);
        if (this.isUsableOverride(workflow)) {
          return {
            workflowId: workflow.id,
            source: 'project_override' as const,
            workflow,
          };
        }
      }
    }

    const globalConfig = this.db
      .prepare('SELECT permission_workflow_override_id FROM agent_config WHERE id = 1')
      .get() as { permission_workflow_override_id?: string | null } | undefined;
    if (globalConfig?.permission_workflow_override_id) {
      const workflow = this.workflowRepo.findById(globalConfig.permission_workflow_override_id);
      if (this.isUsableOverride(workflow)) {
        return {
          workflowId: workflow.id,
          source: 'global_override' as const,
          workflow,
        };
      }
    }

    const workflow = this.workflowService.getSystemPermissionFallback();
    return {
      workflowId: workflow.id,
      source: 'system_fallback',
      ...(projectId && {
        fallbackReason: 'Project/global permission workflow override unavailable',
      }),
      workflow,
    };
  }

  async triggerPermissionEscalation(
    projectId: string | undefined,
    triggerData: {
      eventPayload: Record<string, unknown>;
      triggerContext?: Record<string, unknown>;
    }
  ): Promise<{ resolved: ResolvedPermissionWorkflow; run: WorkflowRun }> {
    const resolved = this.resolve(projectId);
    const run = await this.workflowService.triggerWorkflow(
      resolved.workflowId,
      'event',
      'event: permission.escalated',
      triggerData,
      'event'
    );
    return { resolved, run };
  }

  getRun(runId: string): ReturnType<WorkflowService['getRun']> {
    return this.workflowService.getRun(runId);
  }
}
