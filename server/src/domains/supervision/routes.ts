import { Router, type Request, type Response } from 'express';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import type {
  AcceptanceDecision,
  ChangeExecutionPlan,
  DesignGateDecision,
  ExecutionGateDecision,
  ProjectAgent,
  ProjectChange,
  SupervisionTask,
} from '@zclaudia/shared/features/supervision';
import {
  sendRouteError,
  type RouteErrorPolicy,
  type RouteErrorRule,
} from '../../utils/route-error-mapping.js';
import type { SupervisorService } from './supervisor-service.js';
import type { ContextDocument } from './context-manager.js';

type SupervisionLogRows = ReturnType<SupervisorService['getLogs']>;

/**
 * Error → HTTP contracts, one policy per route.
 *
 * Typed `SupervisorError`s (status + code) thrown by the service win outright.
 * The rules/fallback pairs exist for plain `Error`s — legacy throw paths and
 * test doubles — and reproduce byte-for-byte the responses the previous
 * inline `message.includes(...)` handlers produced.
 */
const NOT_FOUND_ON_MESSAGE: RouteErrorRule = { match: 'not found', status: 404, code: 'NOT_FOUND' };

const INIT_ERROR: RouteErrorPolicy = {
  fallback: { status: 400, code: 'INIT_ERROR' },
  nonErrorMessage: 'Failed to initialize agent',
};

const AGENT_ACTION_ERROR: RouteErrorPolicy = {
  rules: [{ match: 'not in', status: 400, code: 'INVALID_STATE' }],
  fallback: { status: 500, code: 'INTERNAL_ERROR' },
  nonErrorMessage: 'Failed to update agent',
};

const GET_AGENT_ERROR: RouteErrorPolicy = {
  fallback: { status: 500, code: 'INTERNAL_ERROR' },
  fixedMessage: 'Failed to get agent',
};

const LIST_CHANGES_ERROR: RouteErrorPolicy = {
  fallback: { status: 500, code: 'INTERNAL_ERROR' },
  fixedMessage: 'Failed to list changes',
};

const GET_ACTIVE_CHANGE_ERROR: RouteErrorPolicy = {
  fallback: { status: 500, code: 'INTERNAL_ERROR' },
  fixedMessage: 'Failed to get active change',
};

const CREATE_CHANGE_ERROR: RouteErrorPolicy = {
  rules: [{ match: 'already has an active change', status: 409, code: 'ACTIVE_CHANGE_EXISTS' }],
  fallback: { status: 400, code: 'CREATE_ERROR' },
  nonErrorMessage: 'Failed to create change',
};

const GET_CHANGE_ERROR: RouteErrorPolicy = {
  fallback: { status: 500, code: 'INTERNAL_ERROR' },
  fixedMessage: 'Failed to get change',
};

const EXECUTION_PLAN_ERROR: RouteErrorPolicy = {
  rules: [{ match: 'Change not found', status: 404, code: 'NOT_FOUND' }],
  fallback: { status: 500, code: 'INTERNAL_ERROR' },
  nonErrorMessage: 'Failed to get execution plan',
};

const REQUEST_DESIGN_GATE_ERROR: RouteErrorPolicy = {
  rules: [NOT_FOUND_ON_MESSAGE],
  fallback: { status: 400, code: 'REQUEST_ERROR' },
  nonErrorMessage: 'Failed to request design gate',
};

const RESOLVE_DESIGN_GATE_ERROR: RouteErrorPolicy = {
  rules: [NOT_FOUND_ON_MESSAGE],
  fallback: { status: 400, code: 'RESOLVE_ERROR' },
  nonErrorMessage: 'Failed to resolve design gate',
};

const REQUEST_EXECUTION_GATE_ERROR: RouteErrorPolicy = {
  rules: [NOT_FOUND_ON_MESSAGE],
  fallback: { status: 400, code: 'REQUEST_ERROR' },
  nonErrorMessage: 'Failed to request execution gate',
};

const RESOLVE_EXECUTION_GATE_ERROR: RouteErrorPolicy = {
  rules: [NOT_FOUND_ON_MESSAGE],
  fallback: { status: 400, code: 'RESOLVE_ERROR' },
  nonErrorMessage: 'Failed to resolve execution gate',
};

const REQUEST_ACCEPTANCE_ERROR: RouteErrorPolicy = {
  rules: [NOT_FOUND_ON_MESSAGE],
  fallback: { status: 400, code: 'INVALID_STATE' },
  nonErrorMessage: 'Failed to request acceptance',
};

const RESOLVE_ACCEPTANCE_ERROR: RouteErrorPolicy = {
  rules: [NOT_FOUND_ON_MESSAGE],
  fallback: { status: 400, code: 'INVALID_STATE' },
  nonErrorMessage: 'Failed to resolve acceptance',
};

const REQUEST_CHANGE_SYNC_ERROR: RouteErrorPolicy = {
  rules: [NOT_FOUND_ON_MESSAGE],
  fallback: { status: 400, code: 'INVALID_STATE' },
  nonErrorMessage: 'Failed to request change sync',
};

const COMPLETE_CHANGE_ERROR: RouteErrorPolicy = {
  rules: [NOT_FOUND_ON_MESSAGE],
  fallback: { status: 400, code: 'INVALID_STATE' },
  nonErrorMessage: 'Failed to complete change',
};

const LIST_TASKS_ERROR: RouteErrorPolicy = {
  fallback: { status: 500, code: 'INTERNAL_ERROR' },
  fixedMessage: 'Failed to list tasks',
};

const CREATE_TASK_ERROR: RouteErrorPolicy = {
  rules: [
    { match: 'budget', status: 409, code: 'BUDGET_EXCEEDED' },
    { match: 'No agent', status: 400, code: 'INTERNAL_ERROR' },
    { match: 'Change not found', status: 400, code: 'INTERNAL_ERROR' },
    { match: 'does not belong to project', status: 400, code: 'INTERNAL_ERROR' },
  ],
  fallback: { status: 500, code: 'INTERNAL_ERROR' },
  nonErrorMessage: 'Failed to create task',
};

const UPDATE_TASK_ERROR: RouteErrorPolicy = {
  fallback: { status: 500, code: 'INTERNAL_ERROR' },
  fixedMessage: 'Failed to update task',
};

const APPROVE_TASK_ERROR: RouteErrorPolicy = {
  fallback: { status: 400, code: 'INVALID_STATE' },
  nonErrorMessage: 'Failed to approve task',
};

const REJECT_TASK_ERROR: RouteErrorPolicy = {
  fallback: { status: 400, code: 'INVALID_STATE' },
  nonErrorMessage: 'Failed to reject task',
};

const APPROVE_TASK_RESULT_ERROR: RouteErrorPolicy = {
  fallback: { status: 400, code: 'INVALID_STATE' },
  nonErrorMessage: 'Failed to approve task result',
};

const REJECT_TASK_RESULT_ERROR: RouteErrorPolicy = {
  fallback: { status: 400, code: 'INVALID_STATE' },
  nonErrorMessage: 'Failed to reject task result',
};

const RESOLVE_CONFLICT_ERROR: RouteErrorPolicy = {
  rules: [{ match: 'not in merge_conflict', status: 400, code: 'INVALID_STATE' }],
  fallback: { status: 500, code: 'MERGE_ERROR' },
  nonErrorMessage: 'Failed to resolve conflict',
};

const OPEN_TASK_SESSION_ERROR: RouteErrorPolicy = {
  rules: [NOT_FOUND_ON_MESSAGE],
  fallback: { status: 500, code: 'INTERNAL_ERROR' },
  nonErrorMessage: 'Failed to open task session',
};

const TASK_PLAN_STATUS_ERROR: RouteErrorPolicy = {
  rules: [NOT_FOUND_ON_MESSAGE],
  fallback: { status: 500, code: 'INTERNAL_ERROR' },
  nonErrorMessage: 'Failed to get plan status',
};

const SUBMIT_TASK_PLAN_ERROR: RouteErrorPolicy = {
  rules: [
    { match: 'incomplete', status: 400, code: 'VALIDATION_ERROR' },
    NOT_FOUND_ON_MESSAGE,
    { match: 'not in planning status', status: 409, code: 'INVALID_STATE' },
  ],
  fallback: { status: 500, code: 'INTERNAL_ERROR' },
  nonErrorMessage: 'Failed to submit plan',
};

const RELOAD_CONTEXT_ERROR: RouteErrorPolicy = {
  fallback: { status: 500, code: 'INTERNAL_ERROR' },
  nonErrorMessage: 'Failed to reload context',
};

const BUDGET_ERROR: RouteErrorPolicy = {
  fallback: { status: 500, code: 'INTERNAL_ERROR' },
  fixedMessage: 'Failed to get budget',
};

const LOGS_ERROR: RouteErrorPolicy = {
  fallback: { status: 500, code: 'INTERNAL_ERROR' },
  fixedMessage: 'Failed to get logs',
};

const CONTEXT_DOCUMENTS_ERROR: RouteErrorPolicy = {
  fallback: { status: 500, code: 'INTERNAL_ERROR' },
  fixedMessage: 'Failed to get context documents',
};

const UPDATE_CHANGE_DOCUMENT_ERROR: RouteErrorPolicy = {
  rules: [NOT_FOUND_ON_MESSAGE],
  fallback: { status: 400, code: 'UPDATE_ERROR' },
  nonErrorMessage: 'Failed to update change document',
};

const RETRY_TASK_ERROR: RouteErrorPolicy = {
  rules: [NOT_FOUND_ON_MESSAGE],
  fallback: { status: 400, code: 'INVALID_STATE' },
  nonErrorMessage: 'Failed to retry task',
};

const CANCEL_TASK_ERROR: RouteErrorPolicy = {
  rules: [NOT_FOUND_ON_MESSAGE],
  fallback: { status: 400, code: 'INVALID_STATE' },
  nonErrorMessage: 'Failed to cancel task',
};

const RUN_TASK_NOW_ERROR: RouteErrorPolicy = {
  rules: [NOT_FOUND_ON_MESSAGE],
  fallback: { status: 400, code: 'INVALID_STATE' },
  nonErrorMessage: 'Failed to run task',
};

export function createSupervisionRoutes(service: SupervisorService): Router {
  const router = Router();

  // POST /projects/:projectId/agent/init — Initialize agent
  router.post('/projects/:projectId/agent/init', (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { config, mode } = req.body;
      const agent = service.initAgent(projectId, config, mode);
      res.json({ success: true, data: agent } as ApiResponse<ProjectAgent>);
    } catch (error) {
      sendRouteError(res, error, INIT_ERROR);
    }
  });

  // POST /projects/:projectId/agent/action — Pause/resume/archive/approve_setup
  router.post('/projects/:projectId/agent/action', (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { action } = req.body;
      if (!action || !['pause', 'resume', 'archive', 'approve_setup'].includes(action)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'action must be one of: pause, resume, archive, approve_setup',
          },
        } as ApiResponse<never>);
        return;
      }
      const agent = service.updateAgentPhase(projectId, action);
      res.json({ success: true, data: agent } as ApiResponse<ProjectAgent>);
    } catch (error) {
      sendRouteError(res, error, AGENT_ACTION_ERROR);
    }
  });

  // GET /projects/:projectId/agent — Get agent state
  router.get('/projects/:projectId/agent', (req: Request, res: Response) => {
    try {
      const agent = service.getAgent(req.params.projectId);
      if (!agent) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'No agent for this project' },
        } as ApiResponse<never>);
        return;
      }
      res.json({ success: true, data: agent } as ApiResponse<ProjectAgent>);
    } catch (error) {
      sendRouteError(res, error, GET_AGENT_ERROR);
    }
  });

  // GET /projects/:projectId/changes — List project changes
  router.get('/projects/:projectId/changes', (req: Request, res: Response) => {
    try {
      const changes = service.getChanges(req.params.projectId);
      res.json({ success: true, data: changes } as ApiResponse<ProjectChange[]>);
    } catch (error) {
      sendRouteError(res, error, LIST_CHANGES_ERROR);
    }
  });

  // GET /projects/:projectId/changes/active — Get active project change
  router.get('/projects/:projectId/changes/active', (req: Request, res: Response) => {
    try {
      const change = service.getActiveChange(req.params.projectId);
      if (!change) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'No active change for this project' },
        } as ApiResponse<never>);
        return;
      }
      res.json({ success: true, data: change } as ApiResponse<ProjectChange>);
    } catch (error) {
      sendRouteError(res, error, GET_ACTIVE_CHANGE_ERROR);
    }
  });

  // POST /projects/:projectId/changes — Create change
  router.post('/projects/:projectId/changes', (req: Request, res: Response) => {
    try {
      const { title, summary, motivation, nonGoals, scope, acceptanceCriteria } = req.body;
      if (!title || !summary) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'title and summary are required' },
        } as ApiResponse<never>);
        return;
      }
      const change = service.createChange(req.params.projectId, {
        title,
        summary,
        motivation,
        nonGoals,
        scope,
        acceptanceCriteria,
      });
      res.json({ success: true, data: change } as ApiResponse<ProjectChange>);
    } catch (error) {
      sendRouteError(res, error, CREATE_CHANGE_ERROR);
    }
  });

  // GET /changes/:changeId — Get change
  router.get('/changes/:changeId', (req: Request, res: Response) => {
    try {
      const change = service.getChange(req.params.changeId);
      if (!change) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Change not found' },
        } as ApiResponse<never>);
        return;
      }
      res.json({ success: true, data: change } as ApiResponse<ProjectChange>);
    } catch (error) {
      sendRouteError(res, error, GET_CHANGE_ERROR);
    }
  });

  // GET /changes/:changeId/execution — Minimal execution plan summary
  router.get('/changes/:changeId/execution', (req: Request, res: Response) => {
    try {
      const plan = service.getExecutionPlan(req.params.changeId);
      res.json({ success: true, data: plan } as ApiResponse<ChangeExecutionPlan>);
    } catch (error) {
      sendRouteError(res, error, EXECUTION_PLAN_ERROR);
    }
  });

  // POST /changes/:changeId/gates/design/request — Request design review
  router.post('/changes/:changeId/gates/design/request', (req: Request, res: Response) => {
    try {
      const change = service.requestDesignGate(req.params.changeId, req.body?.notes);
      res.json({ success: true, data: change } as ApiResponse<ProjectChange>);
    } catch (error) {
      sendRouteError(res, error, REQUEST_DESIGN_GATE_ERROR);
    }
  });

  // POST /changes/:changeId/gates/design/resolve — Resolve design review
  router.post('/changes/:changeId/gates/design/resolve', (req: Request, res: Response) => {
    try {
      const { decision, notes } = req.body as { decision?: DesignGateDecision; notes?: string };
      if (!decision || !['approve_design', 'revise_design', 'revise_change'].includes(decision)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'decision must be one of: approve_design, revise_design, revise_change',
          },
        } as ApiResponse<never>);
        return;
      }
      const change = service.resolveDesignGate(req.params.changeId, decision, notes);
      res.json({ success: true, data: change } as ApiResponse<ProjectChange>);
    } catch (error) {
      sendRouteError(res, error, RESOLVE_DESIGN_GATE_ERROR);
    }
  });

  // POST /changes/:changeId/gates/execution/request — Request execution review
  router.post('/changes/:changeId/gates/execution/request', (req: Request, res: Response) => {
    try {
      const change = service.requestExecutionGate(req.params.changeId, req.body?.notes);
      res.json({ success: true, data: change } as ApiResponse<ProjectChange>);
    } catch (error) {
      sendRouteError(res, error, REQUEST_EXECUTION_GATE_ERROR);
    }
  });

  // POST /changes/:changeId/gates/execution/resolve — Resolve execution review
  router.post('/changes/:changeId/gates/execution/resolve', (req: Request, res: Response) => {
    try {
      const { decision, notes } = req.body as { decision?: ExecutionGateDecision; notes?: string };
      if (
        !decision ||
        !['approve_execution', 'revise_plan', 'revise_design', 'split_change'].includes(decision)
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'decision must be one of: approve_execution, revise_plan, revise_design, split_change',
          },
        } as ApiResponse<never>);
        return;
      }
      const change = service.resolveExecutionGate(req.params.changeId, decision, notes);
      res.json({ success: true, data: change } as ApiResponse<ProjectChange>);
    } catch (error) {
      sendRouteError(res, error, RESOLVE_EXECUTION_GATE_ERROR);
    }
  });

  router.post('/changes/:changeId/acceptance/request', (req: Request, res: Response) => {
    try {
      const change = service.requestAcceptance(req.params.changeId, req.body?.notes);
      res.json({ success: true, data: change } as ApiResponse<ProjectChange>);
    } catch (error) {
      sendRouteError(res, error, REQUEST_ACCEPTANCE_ERROR);
    }
  });

  router.post('/changes/:changeId/acceptance/resolve', (req: Request, res: Response) => {
    try {
      const { decision, notes } = req.body as { decision?: AcceptanceDecision; notes?: string };
      if (!decision || !['approve_acceptance', 'revise_execution'].includes(decision)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'decision must be one of: approve_acceptance, revise_execution',
          },
        } as ApiResponse<never>);
        return;
      }
      const change = service.resolveAcceptance(req.params.changeId, decision, notes);
      res.json({ success: true, data: change } as ApiResponse<ProjectChange>);
    } catch (error) {
      sendRouteError(res, error, RESOLVE_ACCEPTANCE_ERROR);
    }
  });

  router.post('/changes/:changeId/sync/request', (req: Request, res: Response) => {
    try {
      const change = service.requestChangeSync(req.params.changeId, req.body?.summary);
      res.json({ success: true, data: change } as ApiResponse<ProjectChange>);
    } catch (error) {
      sendRouteError(res, error, REQUEST_CHANGE_SYNC_ERROR);
    }
  });

  router.post('/changes/:changeId/complete', (req: Request, res: Response) => {
    try {
      const change = service.completeChange(req.params.changeId, req.body?.summary);
      res.json({ success: true, data: change } as ApiResponse<ProjectChange>);
    } catch (error) {
      sendRouteError(res, error, COMPLETE_CHANGE_ERROR);
    }
  });

  // GET /projects/:projectId/tasks — List tasks
  router.get('/projects/:projectId/tasks', (req: Request, res: Response) => {
    try {
      const changeId = typeof req.query.changeId === 'string' ? req.query.changeId : undefined;
      const tasks = service.getTasks(req.params.projectId, changeId);
      res.json({ success: true, data: tasks } as ApiResponse<SupervisionTask[]>);
    } catch (error) {
      sendRouteError(res, error, LIST_TASKS_ERROR);
    }
  });

  // POST /projects/:projectId/tasks — Create task
  router.post('/projects/:projectId/tasks', (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const {
        changeId,
        title,
        description,
        dependencies,
        dependencyMode,
        priority,
        acceptanceCriteria,
        relevantDocIds,
        scope,
        scheduleCron,
        scheduleEnabled,
        retryDelayMs,
      } = req.body;
      if (!title || !description) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'title and description are required' },
        } as ApiResponse<never>);
        return;
      }
      const task = service.createTask(projectId, {
        changeId,
        title,
        description,
        dependencies,
        dependencyMode,
        priority,
        acceptanceCriteria,
        relevantDocIds,
        scope,
        scheduleCron,
        scheduleEnabled,
        retryDelayMs,
      });
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      sendRouteError(res, error, CREATE_TASK_ERROR);
    }
  });

  // PUT /tasks/:taskId — Update task
  router.put('/tasks/:taskId', (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const task = service.updateTask(taskId, req.body);
      if (!task) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Task not found' },
        } as ApiResponse<never>);
        return;
      }
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      sendRouteError(res, error, UPDATE_TASK_ERROR);
    }
  });

  // POST /tasks/:taskId/approve — Approve proposed task
  router.post('/tasks/:taskId/approve', (req: Request, res: Response) => {
    try {
      const task = service.approveTask(req.params.taskId);
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      sendRouteError(res, error, APPROVE_TASK_ERROR);
    }
  });

  // POST /tasks/:taskId/reject — Reject proposed task
  router.post('/tasks/:taskId/reject', (req: Request, res: Response) => {
    try {
      const task = service.rejectTask(req.params.taskId);
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      sendRouteError(res, error, REJECT_TASK_ERROR);
    }
  });

  // POST /tasks/:taskId/review/approve — Manual review: approve (may trigger merge)
  router.post('/tasks/:taskId/review/approve', async (req: Request, res: Response) => {
    try {
      const task = await service.approveTaskResult(req.params.taskId);
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      sendRouteError(res, error, APPROVE_TASK_RESULT_ERROR);
    }
  });

  // POST /tasks/:taskId/review/reject — Manual review: reject
  router.post('/tasks/:taskId/review/reject', (req: Request, res: Response) => {
    try {
      const { notes } = req.body;
      if (!notes) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'notes are required' },
        } as ApiResponse<never>);
        return;
      }
      const task = service.rejectTaskResult(req.params.taskId, notes);
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      sendRouteError(res, error, REJECT_TASK_RESULT_ERROR);
    }
  });

  // POST /tasks/:taskId/resolve-conflict — Resolve merge conflict
  router.post('/tasks/:taskId/resolve-conflict', async (req: Request, res: Response) => {
    try {
      const task = await service.resolveConflict(req.params.taskId);
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      sendRouteError(res, error, RESOLVE_CONFLICT_ERROR);
    }
  });

  // POST /tasks/:taskId/open-session — Lazily create/return session for a task
  router.post('/tasks/:taskId/open-session', (req: Request, res: Response) => {
    try {
      const result = service.openTaskSession(req.params.taskId);
      res.json({ success: true, data: result } as ApiResponse<{ sessionId: string }>);
    } catch (error) {
      sendRouteError(res, error, OPEN_TASK_SESSION_ERROR);
    }
  });

  // GET /tasks/:taskId/plan-status — Validate planning document completeness
  router.get('/tasks/:taskId/plan-status', (req: Request, res: Response) => {
    try {
      const status = service.getTaskPlanStatus(req.params.taskId);
      res.json({ success: true, data: status });
    } catch (error) {
      sendRouteError(res, error, TASK_PLAN_STATUS_ERROR);
    }
  });

  // POST /tasks/:taskId/plan/submit — Submit plan when validator passes
  router.post('/tasks/:taskId/plan/submit', (req: Request, res: Response) => {
    try {
      const result = service.submitTaskPlan(req.params.taskId);
      res.json({ success: true, data: result });
    } catch (error) {
      sendRouteError(res, error, SUBMIT_TASK_PLAN_ERROR);
    }
  });

  // POST /projects/:projectId/context/reload — Reload .supervision/
  router.post('/projects/:projectId/context/reload', (req: Request, res: Response) => {
    try {
      service.reloadContext(req.params.projectId);
      res.json({ success: true, data: null } as ApiResponse<null>);
    } catch (error) {
      sendRouteError(res, error, RELOAD_CONTEXT_ERROR);
    }
  });

  // GET /projects/:projectId/budget — Get token usage
  router.get('/projects/:projectId/budget', (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const usage = service.getTokenUsage(projectId);
      const agent = service.getAgent(projectId);
      const limit = agent?.config?.maxTokenBudget;
      res.json({
        success: true,
        data: {
          usage,
          limit,
          remaining: limit !== undefined ? Math.max(0, limit - usage) : undefined,
        },
      } as ApiResponse<{ usage: number; limit?: number; remaining?: number }>);
    } catch (error) {
      sendRouteError(res, error, BUDGET_ERROR);
    }
  });

  // GET /projects/:projectId/logs — Get supervision logs
  router.get('/projects/:projectId/logs', (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = service.getLogs(projectId, limit);
      res.json({ success: true, data: logs } as ApiResponse<SupervisionLogRows>);
    } catch (error) {
      sendRouteError(res, error, LOGS_ERROR);
    }
  });

  // GET /projects/:projectId/context — Get context documents
  router.get('/projects/:projectId/context', (req: Request, res: Response) => {
    try {
      const documents = service.getContextDocuments(req.params.projectId);
      res.json({ success: true, data: documents } as ApiResponse<ContextDocument[]>);
    } catch (error) {
      sendRouteError(res, error, CONTEXT_DOCUMENTS_ERROR);
    }
  });

  // PUT /changes/:changeId/docs/:docType — Update editable change documents
  router.put('/changes/:changeId/docs/:docType', (req: Request, res: Response) => {
    try {
      const docType = req.params.docType;
      const { content } = req.body as { content?: string };
      if (!['design', 'execution', 'tasks'].includes(docType)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'docType must be one of: design, execution, tasks',
          },
        } as ApiResponse<never>);
        return;
      }
      if (typeof content !== 'string') {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'content is required' },
        } as ApiResponse<never>);
        return;
      }
      const change = service.updateChangeDocument(
        req.params.changeId,
        docType as 'design' | 'execution' | 'tasks',
        content
      );
      res.json({ success: true, data: change } as ApiResponse<ProjectChange>);
    } catch (error) {
      sendRouteError(res, error, UPDATE_CHANGE_DOCUMENT_ERROR);
    }
  });

  // POST /tasks/:taskId/retry — Manually retry a failed/cancelled task
  router.post('/tasks/:taskId/retry', (req: Request, res: Response) => {
    try {
      const task = service.retryTask(req.params.taskId);
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      sendRouteError(res, error, RETRY_TASK_ERROR);
    }
  });

  // POST /tasks/:taskId/cancel — Cancel a running/queued task
  router.post('/tasks/:taskId/cancel', (req: Request, res: Response) => {
    try {
      const task = service.cancelTask(req.params.taskId);
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      sendRouteError(res, error, CANCEL_TASK_ERROR);
    }
  });

  // POST /tasks/:taskId/run-now — Immediately queue a scheduled/terminal task
  router.post('/tasks/:taskId/run-now', (req: Request, res: Response) => {
    try {
      const task = service.runTaskNow(req.params.taskId);
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      sendRouteError(res, error, RUN_TASK_NOW_ERROR);
    }
  });

  return router;
}
