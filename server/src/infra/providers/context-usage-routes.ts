import { Router, type Request, type Response } from 'express';
import { computeContextUsage, getContextSnapshot } from './context-snapshot.js';

export interface ContextUsageRoutesDeps {
  /**
   * Whether the session's runtime captures context snapshots at all (only the
   * built-in Pi runtime does — external CLI runtimes never populate the store).
   * Lets the client distinguish "no run yet" from "never going to have data".
   * Unknown sessions should resolve to true so the copy stays generic.
   */
  supportsContextBreakdown?: (sessionId: string) => boolean;
}

export function createContextUsageRoutes(deps: ContextUsageRoutesDeps = {}): Router {
  const router = Router();

  router.get('/sessions/:sessionId/context-usage', (req: Request, res: Response) => {
    const snapshot = getContextSnapshot(req.params.sessionId);
    if (!snapshot) {
      // "No data yet" is a normal state (no run yet / server restarted), not an error.
      const supported = deps.supportsContextBreakdown?.(req.params.sessionId) ?? true;
      res.json({ success: true, data: { available: false, supported } });
      return;
    }
    res.json({ success: true, data: { available: true, ...computeContextUsage(snapshot) } });
  });

  return router;
}
