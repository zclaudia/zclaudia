import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { ManagedRuntimePolicy } from '@zclaudia/shared/plugins/managed-runtimes';
import { managedRuntimeService, type ManagedRuntimeService } from './service.js';

function sendError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  res.status(400).json({
    success: false,
    error: { code: 'MANAGED_RUNTIME_ERROR', message },
  });
}

export function createManagedRuntimeRoutes(
  localOnlyMiddleware: RequestHandler,
  service: ManagedRuntimeService = managedRuntimeService
): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await service.listStatuses() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/settings', async (_req: Request, res: Response) => {
    try {
      const settings = await service.getSettings();
      res.json({
        success: true,
        data: {
          policy: settings.policy,
          trustedPublishers: settings.trustedPublishers,
          enterpriseMirrorOrigins: settings.enterpriseMirrorOrigins,
        },
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put('/settings/policy', localOnlyMiddleware, async (req: Request, res: Response) => {
    try {
      const policy = req.body?.policy as ManagedRuntimePolicy;
      res.json({ success: true, data: await service.setPolicy(policy) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/install', localOnlyMiddleware, async (req: Request, res: Response) => {
    try {
      if (
        typeof req.body?.pluginId !== 'string' ||
        typeof req.body?.pluginVersion !== 'string' ||
        typeof req.body?.runtime !== 'string' ||
        req.body?.approved !== true
      ) {
        throw new Error('pluginId, pluginVersion, runtime, and approved=true are required');
      }
      const data = await service.installForPlugin({
        pluginId: req.body.pluginId,
        pluginVersion: req.body.pluginVersion,
        runtime: req.body.runtime,
        version: typeof req.body.version === 'string' ? req.body.version : undefined,
        approved: true,
        pin: req.body.pin !== false,
      });
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/pin', localOnlyMiddleware, async (req: Request, res: Response) => {
    try {
      if (
        typeof req.body?.pluginId !== 'string' ||
        typeof req.body?.pluginVersion !== 'string' ||
        typeof req.body?.runtime !== 'string'
      ) {
        throw new Error('pluginId, pluginVersion, and runtime are required');
      }
      const data = await service.pinVersion(
        req.body.pluginId,
        req.body.pluginVersion,
        req.body.runtime,
        typeof req.body.version === 'string' ? req.body.version : undefined
      );
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/rollback', localOnlyMiddleware, async (req: Request, res: Response) => {
    try {
      if (
        typeof req.body?.pluginId !== 'string' ||
        typeof req.body?.pluginVersion !== 'string' ||
        typeof req.body?.runtime !== 'string'
      ) {
        throw new Error('pluginId, pluginVersion, and runtime are required');
      }
      const data = await service.rollbackReference(
        req.body.pluginId,
        req.body.pluginVersion,
        req.body.runtime
      );
      res.json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/test', localOnlyMiddleware, async (req: Request, res: Response) => {
    try {
      if (typeof req.body?.pluginId !== 'string' || typeof req.body?.runtime !== 'string') {
        throw new Error('pluginId and runtime are required');
      }
      res.json({
        success: true,
        data: await service.testRuntime(req.body.pluginId, req.body.runtime),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/gc', localOnlyMiddleware, async (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await service.garbageCollect() });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
