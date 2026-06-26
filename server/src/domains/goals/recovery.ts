import type { GoalService } from './service.js';

export interface CoordinatorLike {
  onTurnCompleted(sessionId: string): Promise<void>;
}

export async function recoverActiveGoals(svc: GoalService, coord: CoordinatorLike): Promise<void> {
  const active = svc.listActive();
  await Promise.all(
    active.map((g) =>
      coord.onTurnCompleted(g.sessionId).catch((err) =>
        console.error(`[goal] recovery failed for session ${g.sessionId}:`, err),
      ),
    ),
  );
}
