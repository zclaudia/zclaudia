import { Router, type Request, type Response } from 'express';
import { computeContextUsage, getContextSnapshot } from './context-snapshot.js';

export function createContextUsageRoutes(): Router {
  const router = Router();

  router.get('/sessions/:sessionId/context-usage', (req: Request, res: Response) => {
    const snapshot = getContextSnapshot(req.params.sessionId);
    if (!snapshot) {
      // "No data yet" is a normal state (no run yet / server restarted), not an error.
      res.json({ success: true, data: { available: false } });
      return;
    }
    res.json({ success: true, data: { available: true, ...computeContextUsage(snapshot) } });
  });

  return router;
}
