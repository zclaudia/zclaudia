import { Router, type Request, type Response } from 'express';
import { sendApiError } from '../../interfaces/http/response.js';
import type { GoalService } from './service.js';

export function createGoalRoutes(svc: GoalService): Router {
  const router = Router({ mergeParams: true });

  // GET /sessions/:id/goal
  router.get('/', (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const goal = svc.getActive(sessionId);
    res.json({ success: true, data: goal });
  });

  // PUT /sessions/:id/goal
  router.put('/', (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const body = req.body as { objective?: string; tokenBudget?: number; maxTurns?: number };
    if (!body || typeof body.objective !== 'string') {
      return sendApiError(res, 400, 'invalid_input', 'objective is required');
    }
    try {
      const goal = svc.setGoal(sessionId, {
        objective: body.objective,
        tokenBudget: body.tokenBudget,
        maxTurns: body.maxTurns,
      });
      return res.status(201).json({ success: true, data: goal });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      const status = message.includes('active goal') ? 409 : 400;
      return sendApiError(res, status, 'goal_conflict', message);
    }
  });

  // POST /sessions/:id/goal/pause
  router.post('/pause', (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const goal = svc.getActive(sessionId);
    if (!goal) return sendApiError(res, 404, 'no_active_goal', 'no active goal for this session');
    try {
      return res.json({ success: true, data: svc.pause(goal.id) });
    } catch (err) {
      return sendApiError(res, 400, 'invalid_transition', (err as Error).message);
    }
  });

  // POST /sessions/:id/goal/resume
  router.post('/resume', (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const goal = svc.getActive(sessionId);
    if (!goal) return sendApiError(res, 404, 'no_active_goal', 'no active goal for this session');
    try {
      return res.json({ success: true, data: svc.resume(goal.id) });
    } catch (err) {
      return sendApiError(res, 400, 'invalid_transition', (err as Error).message);
    }
  });

  // DELETE /sessions/:id/goal
  router.delete('/', (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const goal = svc.getActive(sessionId);
    if (!goal) return sendApiError(res, 404, 'no_active_goal', 'no active goal for this session');
    return res.json({ success: true, data: svc.clear(goal.id) });
  });

  return router;
}
