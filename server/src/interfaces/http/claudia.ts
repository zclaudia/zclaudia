import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
import type { BranchAction, ClaudiaTaskStatus } from '@zclaudia/shared/wire/messages';

interface CanonicalTaskRow {
  id: string;
  session_id: string | null;
  status: string;
  title: string | null;
  description: string | null;
  result: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

interface ClaudiaTaskResponse {
  id: string;
  sessionId: string | null;
  branchId: string | null;
  branchAction?: BranchAction;
  contextReset?: boolean;
  input: string;
  title: string;
  status: ClaudiaTaskStatus;
  summary?: string;
  error?: string;
  responseText?: string;
  toolCount?: number;
  createdAt: number;
  updatedAt: number;
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function mapCanonicalStatus(status: string): ClaudiaTaskStatus {
  if (status === 'stopped') return 'cancelled' as ClaudiaTaskStatus;
  return status as ClaudiaTaskStatus;
}

interface ClaudiaThreadSessionSummary {
  id: string;
  name: string | null;
  agentProfileId: string | null;
  lastRunStatus: string | null;
  updatedAt: number | null;
}

interface ClaudiaThreadResponse {
  id: string;
  projectId: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  lastTaskId: string | null;
  session: ClaudiaThreadSessionSummary | null;
}

interface ThreadRow {
  id: string;
  host_project_id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  last_task_id: string | null;
  session_id: string | null;
  session_name: string | null;
  agent_profile_id: string | null;
  last_run_status: string | null;
  session_updated_at: number | null;
}

function mapThreadRow(row: ThreadRow): ClaudiaThreadResponse {
  return {
    id: row.id,
    projectId: row.host_project_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastTaskId: row.last_task_id,
    session:
      row.session_id != null
        ? {
            id: row.session_id,
            name: row.session_name,
            agentProfileId: row.agent_profile_id,
            lastRunStatus: row.last_run_status,
            updatedAt: row.session_updated_at,
          }
        : null,
  };
}

export function createClaudiaRoutes(db: Database.Database): Router {
  const router = Router();

  // GET /api/claudia/threads?projectId=xxx — discussion threads (claudia_branches)
  // with their bound standard session. P0 read path: the client re-finds the
  // session through the thread instead of through canonical tasks.
  router.get('/threads', (req: Request, res: Response) => {
    try {
      const projectId = req.query.projectId as string;
      if (!projectId) {
        res.status(400).json({
          success: false,
          error: { code: 'MISSING_PROJECT_ID', message: 'projectId is required' },
        });
        return;
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const rows = db
        .prepare(
          `
        SELECT b.id, b.host_project_id, b.title, b.created_at, b.updated_at, b.last_task_id,
               s.id AS session_id, s.name AS session_name, s.agent_profile_id,
               s.last_run_status, s.updated_at AS session_updated_at
        FROM claudia_branches b
        LEFT JOIN sessions s ON s.id = b.active_session_id
        WHERE b.host_project_id = ?
        ORDER BY b.updated_at DESC
        LIMIT ?
      `
        )
        .all(projectId, limit) as ThreadRow[];
      res.json({ success: true, data: { threads: rows.map(mapThreadRow) } });
    } catch (error) {
      console.error('Error listing claudia threads:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list threads' },
      });
    }
  });

  // GET /api/claudia/threads/:threadId — thread detail with the bound session
  // binding and its last run status (recovery snapshot source, design §历史读取).
  router.get('/threads/:threadId', (req: Request, res: Response) => {
    try {
      const row = db
        .prepare(
          `
        SELECT b.id, b.host_project_id, b.title, b.created_at, b.updated_at, b.last_task_id,
               s.id AS session_id, s.name AS session_name, s.agent_profile_id,
               s.last_run_status, s.updated_at AS session_updated_at
        FROM claudia_branches b
        LEFT JOIN sessions s ON s.id = b.active_session_id
        WHERE b.id = ?
      `
        )
        .get(req.params.threadId) as ThreadRow | undefined;
      if (!row) {
        res.status(404).json({
          success: false,
          error: { code: 'THREAD_NOT_FOUND', message: 'Thread not found' },
        });
        return;
      }
      res.json({ success: true, data: { thread: mapThreadRow(row) } });
    } catch (error) {
      console.error('Error reading claudia thread:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to read thread' },
      });
    }
  });

  // GET /api/claudia/tasks?projectId=xxx&limit=50
  // Legacy canonical-task read path. Since P0, inline runs no longer write
  // canonical tasks; this stays so old records remain readable as references.
  router.get('/tasks', (req: Request, res: Response) => {
    try {
      const projectId = req.query.projectId as string;
      if (!projectId) {
        res.status(400).json({
          success: false,
          error: { code: 'MISSING_PROJECT_ID', message: 'projectId is required' },
        });
        return;
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const canonicalRows = db
        .prepare(
          `SELECT id, session_id, status, title, description, result, metadata, created_at, updated_at
         FROM tasks
         WHERE type = 'agent'
           AND json_extract(metadata, '$.initiator') = 'claudia'
           AND json_extract(metadata, '$.projectId') = ?
         ORDER BY created_at DESC
         LIMIT ?`
        )
        .all(projectId, limit) as CanonicalTaskRow[];

      const canonicalTasks: ClaudiaTaskResponse[] = canonicalRows.map(row => {
        const metadata = parseJsonObject(row.metadata);
        const result = parseJsonObject(row.result);
        const input = stringValue(metadata.input) ?? row.description ?? row.title ?? '';
        const title = row.title ?? input.trim().replace(/\s+/g, ' ').slice(0, 80);
        const responseText = stringValue(result.text);
        return {
          id: row.id,
          sessionId: row.session_id,
          branchId: stringValue(metadata.branchId) ?? null,
          branchAction: stringValue(metadata.branchAction) as BranchAction | undefined,
          contextReset: Boolean(metadata.contextReset),
          input,
          title,
          status: mapCanonicalStatus(row.status),
          summary: responseText,
          error: stringValue(result.error),
          responseText,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      });

      const tasks = canonicalTasks.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);

      res.json({ success: true, data: { tasks } });
    } catch (error) {
      console.error('Error listing claudia tasks:', error);
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list tasks' },
      });
    }
  });

  return router;
}
