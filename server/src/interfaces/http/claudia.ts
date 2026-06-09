import { Router, Request, Response } from 'express';
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
      ? parsed as Record<string, unknown>
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

export function createClaudiaRoutes(db: Database.Database): Router {
  const router = Router();

  // GET /api/claudia/tasks?projectId=xxx&limit=50
  router.get('/tasks', (req: Request, res: Response) => {
    try {
      const projectId = req.query.projectId as string;
      if (!projectId) {
        res.status(400).json({ success: false, error: { code: 'MISSING_PROJECT_ID', message: 'projectId is required' } });
        return;
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const canonicalRows = db.prepare(
        `SELECT id, session_id, status, title, description, result, metadata, created_at, updated_at
         FROM tasks
         WHERE type = 'agent'
           AND json_extract(metadata, '$.initiator') = 'claudia'
           AND json_extract(metadata, '$.projectId') = ?
         ORDER BY created_at DESC
         LIMIT ?`
      ).all(projectId, limit) as CanonicalTaskRow[];

      const canonicalTasks: ClaudiaTaskResponse[] = canonicalRows.map((row) => {
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

      const tasks = canonicalTasks
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);

      res.json({ success: true, data: { tasks } });
    } catch (error) {
      console.error('Error listing claudia tasks:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list tasks' } });
    }
  });

  return router;
}
