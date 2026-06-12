import { Router, type Request, type Response } from 'express';
import { getDeferredDiagnosticsResult } from './write-lifecycle.js';

export function createDeferredDiagnosticsRoutes(): Router {
  const router = Router();

  router.get('/deferred-diagnostics/:id', (req: Request, res: Response) => {
    const result = getDeferredDiagnosticsResult(req.params.id);
    if (!result) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Deferred diagnostics result not found' },
      });
      return;
    }

    res.json({ success: true, data: result });
  });

  return router;
}
