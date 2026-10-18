import { Router, type Request, type Response } from 'express';
import type { Database } from 'better-sqlite3';
import type { UpdateAutoTitleConfigRequest } from '@zclaudia/shared/core/server';
import { getAutoTitleConfigView, updateAutoTitleConfig } from '../../utils/auto-title-config.js';
import { sendApiError } from './response.js';

function normalizeUpdateBody(body: Record<string, unknown>): UpdateAutoTitleConfigRequest {
  const update: UpdateAutoTitleConfigRequest = {};
  if (Object.prototype.hasOwnProperty.call(body, 'enabled')) {
    if (typeof body.enabled !== 'boolean') throw new Error('enabled must be a boolean');
    update.enabled = body.enabled;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'model')) {
    if (body.model !== null && typeof body.model !== 'string') {
      throw new Error('model must be a string');
    }
    update.model = body.model;
  }
  return update;
}

export function createAutoTitleConfigRoutes(db: Database): Router {
  const router = Router();

  router.get('/config', (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: getAutoTitleConfigView(db) });
    } catch (error) {
      sendApiError(
        res,
        500,
        'AUTO_TITLE_CONFIG_READ_FAILED',
        error instanceof Error ? error.message : 'Failed to read session title configuration'
      );
    }
  });

  router.put('/config', (req: Request, res: Response) => {
    try {
      const body =
        req.body && typeof req.body === 'object' && !Array.isArray(req.body)
          ? (req.body as Record<string, unknown>)
          : {};
      const update = normalizeUpdateBody(body);
      res.json({ success: true, data: updateAutoTitleConfig(db, update) });
    } catch (error) {
      sendApiError(
        res,
        400,
        'AUTO_TITLE_CONFIG_INVALID',
        error instanceof Error ? error.message : 'Invalid session title configuration'
      );
    }
  });

  return router;
}
