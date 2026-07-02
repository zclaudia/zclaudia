import { Router } from 'express';
import type { Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import type { SessionDraft } from '@zclaudia/shared/core/session';
import { SessionDraftRepository } from './draft-repository.js';
import { SessionRepository } from './repository.js';
import { sendApiError } from '../../interfaces/http/response.js';

export function createSessionDraftRoutes(db: Database.Database): Router {
  const router = Router();
  const repo = new SessionDraftRepository(db);
  const sessionRepo = new SessionRepository(db);

  function ensureSessionExists(req: Request, res: Response): boolean {
    if (sessionRepo.exists(req.params.id)) {
      return true;
    }

    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Session not found' },
    });
    return false;
  }

  function ensureSessionNotArchived(req: Request, res: Response): boolean {
    if (sessionRepo.isArchived(req.params.id)) {
      res.status(409).json({
        success: false,
        error: { code: 'SESSION_ARCHIVED', message: 'Session is archived' },
      });
      return false;
    }
    return true;
  }

  router.get('/:id/draft', (req: Request, res: Response) => {
    try {
      const draft = repo.findBySessionId(req.params.id);
      res.json({ success: true, data: draft } as ApiResponse<SessionDraft | null>);
    } catch (error) {
      sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to load draft', String(error));
    }
  });

  router.put('/:id/draft', (req: Request, res: Response) => {
    try {
      if (!ensureSessionExists(req, res)) return;
      if (!ensureSessionNotArchived(req, res)) return;

      const { content, deviceId } = req.body ?? {};
      if (typeof content !== 'string') {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'content is required' },
        });
        return;
      }

      const draft = repo.upsert(req.params.id, content, deviceId);
      res.json({ success: true, data: draft } as ApiResponse<SessionDraft>);
    } catch (error) {
      const msg = String(error);
      if (msg.includes('100KB')) {
        sendApiError(res, 413, 'DRAFT_TOO_LARGE', msg);
      } else {
        sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to save draft', msg);
      }
    }
  });

  router.post('/:id/draft/lock', (req: Request, res: Response) => {
    try {
      if (!ensureSessionExists(req, res)) return;
      if (!ensureSessionNotArchived(req, res)) return;

      const { deviceId, force } = req.body ?? {};
      if (!deviceId) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'deviceId is required' },
        });
        return;
      }

      if (force) {
        const draft = repo.forceLock(req.params.id, deviceId);
        res.json({ success: true, data: { locked: true, draft } });
      } else {
        const result = repo.acquireLock(req.params.id, deviceId);
        res.json({ success: true, data: { locked: result.success, draft: result.draft } });
      }
    } catch (error) {
      sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to acquire draft lock', String(error));
    }
  });

  router.post('/:id/draft/unlock', (req: Request, res: Response) => {
    try {
      if (!ensureSessionExists(req, res)) {
        return;
      }

      const { deviceId } = req.body ?? {};
      if (!deviceId) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'deviceId is required' },
        });
        return;
      }

      repo.releaseLock(req.params.id, deviceId);
      res.json({ success: true });
    } catch (error) {
      sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to release draft lock', String(error));
    }
  });

  router.post('/:id/draft/archive', (req: Request, res: Response) => {
    try {
      if (!ensureSessionExists(req, res)) {
        return;
      }

      const draft = repo.archive(req.params.id);
      if (!draft) {
        sendApiError(res, 404, 'NOT_FOUND', 'No active draft found');
        return;
      }
      res.json({ success: true, data: draft } as ApiResponse<SessionDraft>);
    } catch (error) {
      sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to archive draft', String(error));
    }
  });

  router.delete('/:id/draft', (req: Request, res: Response) => {
    try {
      if (!ensureSessionExists(req, res)) {
        return;
      }

      const deleted = repo.delete(req.params.id);
      if (!deleted) {
        sendApiError(res, 404, 'NOT_FOUND', 'No draft found');
        return;
      }
      res.json({ success: true });
    } catch (error) {
      sendApiError(res, 500, 'INTERNAL_ERROR', 'Failed to delete draft', String(error));
    }
  });

  return router;
}
