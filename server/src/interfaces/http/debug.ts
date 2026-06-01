import { Router, type Request, type Response } from 'express';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import type Database from 'better-sqlite3';
import { getCrashLogFilePath, readCrashReports } from '../../utils/crash-log.js';
import type { ProcessSupervisor, ManagedProcessRecord } from '../../infra/services/process-supervisor.js';
import type { PermissionWorkflowResolver } from '../../domains/workflows/permission-workflow-resolver.js';

export interface PermissionLogEntry {
  id: string;
  session_id: string;
  tool: string;
  detail: string;
  decision: 'allow' | 'deny';
  remembered: number;
  created_at: number;
}

export function createDebugRoutes(
  processSupervisor?: ProcessSupervisor,
  db?: Database.Database,
  permissionWorkflowResolver?: PermissionWorkflowResolver,
): Router {
  const router = Router();

  router.post('/resolve-permission-workflow', (req: Request, res: Response) => {
    if (!permissionWorkflowResolver) {
      res.status(500).json({
        success: false,
        error: { code: 'NO_RESOLVER', message: 'PermissionWorkflowResolver not available' },
      } satisfies ApiResponse<never>);
      return;
    }

    const projectId = typeof req.body?.projectId === 'string' && req.body.projectId.trim()
      ? req.body.projectId.trim()
      : undefined;

    const resolved = permissionWorkflowResolver.resolve(projectId);
    res.json({
      success: true,
      data: {
        projectId: projectId ?? null,
        source: resolved.source,
        workflowId: resolved.workflowId,
        fallbackReason: resolved.fallbackReason ?? null,
        workflow: {
          id: resolved.workflow.id,
          name: resolved.workflow.name,
          projectId: resolved.workflow.projectId ?? null,
          status: resolved.workflow.status,
          isSystem: resolved.workflow.isSystem === true,
          systemKey: resolved.workflow.systemKey ?? null,
        },
      },
    } satisfies ApiResponse<unknown>);
  });

  router.get('/crashes', (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        reports: readCrashReports(20),
        filePath: getCrashLogFilePath(),
      },
    } satisfies ApiResponse<{ reports: ReturnType<typeof readCrashReports>; filePath: string }>);
  });

  router.get('/processes', (_req: Request, res: Response) => {
    if (!processSupervisor) {
      res.json({
        success: true,
        data: [],
      } satisfies ApiResponse<ManagedProcessRecord[]>);
      return;
    }

    res.json({
      success: true,
      data: processSupervisor.listProcesses(),
    } satisfies ApiResponse<ManagedProcessRecord[]>);
  });

  router.get('/processes/:processId', (req: Request, res: Response) => {
    if (!processSupervisor) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Process supervisor unavailable' },
      } satisfies ApiResponse<never>);
      return;
    }

    const record = processSupervisor.getProcess(req.params.processId);
    if (!record) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Managed process not found' },
      } satisfies ApiResponse<never>);
      return;
    }

    res.json({
      success: true,
      data: record,
    } satisfies ApiResponse<ManagedProcessRecord>);
  });

  router.get('/permission-logs', (req: Request, res: Response) => {
    if (!db) {
      res.json({
        success: true,
        data: { entries: [], total: 0 },
      } satisfies ApiResponse<{ entries: PermissionLogEntry[]; total: number }>);
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const sessionId = req.query.session_id as string | undefined;
    const decision = req.query.decision as string | undefined;

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (sessionId) {
      conditions.push('session_id = ?');
      params.push(sessionId);
    }
    if (decision && ['allow', 'deny'].includes(decision)) {
      conditions.push('decision = ?');
      params.push(decision);
    }

    const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    const total = (db.prepare(`SELECT COUNT(*) as total FROM permission_logs${where}`).get(...params) as { total: number }).total;
    const entries = db.prepare(`SELECT * FROM permission_logs${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as PermissionLogEntry[];

    res.json({
      success: true,
      data: { entries, total },
    } satisfies ApiResponse<{ entries: PermissionLogEntry[]; total: number }>);
  });

  // AI Review simulation is parked until the pi-agent runtime lands.
  // The UI keeps its entry point; the route returns a placeholder so callers
  // can wire to the real runtime once available.
  router.post('/simulate-ai-review', (req: Request, res: Response) => {
    const { toolName, detail, cwd, mode } = req.body as {
      toolName?: string;
      detail?: string;
      cwd?: string;
      mode?: string;
    };

    if (!toolName || !detail || !cwd) {
      res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'toolName, detail, and cwd are required' },
      } satisfies ApiResponse<never>);
      return;
    }

    res.json({
      success: true,
      data: {
        decision: 'uncertain',
        reasoning: 'AI Review is pending pi-agent runtime integration. The simulator will return real results once the runtime is wired.',
        confidence: 0,
        durationMs: 0,
        mode: mode ?? 'quick',
        llmProfileId: null,
        providerType: null,
        pendingPiAgent: true,
      },
    });
  });

  return router;
}
